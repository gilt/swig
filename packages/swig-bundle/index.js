

/*
 ________  ___       __   ___  ________
|\   ____\|\  \     |\  \|\  \|\   ____\
\ \  \___|\ \  \    \ \  \ \  \ \  \___|
 \ \_____  \ \  \  __\ \  \ \  \ \  \  ___
  \|____|\  \ \  \|\__\_\  \ \  \ \  \|\  \
    ____\_\  \ \____________\ \__\ \_______\
   |\_________\|____________|\|__|\|_______|
   \|_________|

   It's delicious.
   Brought to you by the fine folks at Gilt (http://github.com/gilt)

  BUNDLING RULES
  - targetExperiences: ['intermediate', 'full']
    - only shows up in intermediate or full
  - everything goes into flat files

  main.[exp].[src|min].js
  - modules are scanned for target experiences
  - if they are part of a bundle, skip
  - modules (and their deps) with target exps are placed into the corresponding main.[exp] file
  - modules without are placed in all three target exps

  [module].[exp].[src|min].js
  - modules which declare a bundle
  - the root declaring module, and it's deps are placed into [module].[exp] file.
  - if a dependency already exists in the main.**.js file, skip the dep.

  NOTES
  - this is going to require setting up objects first:
  - produce dependency graph
  - populate main.all

  main: {
    full: [],
    intermediate: [],
    minimum: [],
    all: [],
    bundled: []
  }

  main.all will be populated first.
  main.bundled will be populated second, iterating through main.all.
  main.all will remove anything which is also in main.bundled
  main.[exp] populated based on main.all
    - anything without a target exp will be in all three exps.

  [bundle]: {
    full: [],
    intermediate: [],
    minimum: []
  }

  bundle created based on main.bundled.
*/

module.exports = function (gulp, swig) {
  const _ = require('underscore');
  const co = require('co');
  const path = require('path');
  const globby = require('globby');
  const fs = require('fs');
  const execa = require('execa');
  const merge = require('merge-stream');
  const concat = require('./lib/concat-experience');
  const sourcemaps = require('gulp-sourcemaps');

  // Leaving path.join to protect from delimeters
  const basePublicPath = path.join(swig.srcPath(swig));
  const basePath = path.join(basePublicPath, '/js', swig.target.name);

  const modules = {
    full: [],
    intermediate: [],
    minimal: [],
    all: [],
    bundles: [],
    dependencies: {},
    flatDependencies: [],
    bundled: {}
  };

  swig.tell('bundle', { description: 'Bundles Gilt javascript assets.' });

  function indent(what) {
    let result = '';
    _.each(what.split('\n'), (line) => {
      if (line.trim().length) {
        result += `  ${line}\n`;
      } else {
        result += '\n';
      }
    });
    return result.trim();
  }

  // This is a stub of the gilt_define module's methods
  // that we're going to use to pull info from the modules.
  // faster than an AST and isn't an insanely massive regex.
  let evalResults = [];
  const gilt = {
    define: function swigGiltDefine(name, deps, method, opts) {
      const options = opts || {};

      const result = {
        moduleName: name,
        definedDependencies: deps,
        targetExperiences: options.targetExperiences,
        bundle: options.bundle,
        script: method.toString()
      };

    // since arguments.callee won't work here, let's re-wrap the module definition.
      result.script = `${'gilt.define(\n' +
      '  \''}${result.moduleName}',\n  ${
      indent(JSON.stringify(result.definedDependencies, null, 2).replace(/"/g, '\''))},\n${
      result.script},\n  ${
      JSON.stringify(options).replace(/"/g, '\'')
      }\n);\n`;

      evalResults.push(result);
    }
  };

  // eslint-disable-next-line
  const createModule = gilt.define;

  function cleanTree(object) {
    _.each(object, (value, property) => {
      if (property !== 'dependencies') {
        delete object[property];

        _.each(object.dependencies, (dep) => {
          cleanTree(dep);
        });
      }
    });
  }

  // uses npm to tell us which modules are installed
  // we run this on the node_modules directory in temp because npm can make sense of it.
  function* getDependencyGraph(name) {
    const commands = [
      `cd ${swig.temp}`,
      `npm la --json --quiet${name || ''}`
    ];
    const raw = yield execa.shell(commands.join('; '), {
      preferLocal: false
    });
    const result = JSON.parse(raw.stdout);

    cleanTree(result);

    return result.dependencies;
  }

  function examineModules() {
    const bundles = [];
    const glob = [
      path.join(basePublicPath, '/js/**/*.js'),

      // NOTE: For current node apps, `src/` folder contains untranspiled sources, which will be
      // transpiled and put into `app/`. Therefore ignoring the `src/` altogether, as we don't want
      // to send incompatible code to old browsers
      `!${path.join(basePublicPath, '/js/**/src/**/*.js')}`,

      `!${path.join(basePublicPath, '/js/**/internal/**/*.js')}`,
      `!${path.join(basePublicPath, '/js/**/vendor/**/*.js')}`,
      `!${path.join(basePublicPath, '/js/**/{main,bundles}*.js')}`,
      `!${path.join(basePublicPath, '/js/**/*{src,min}.js')}`,
      `!${path.join(basePublicPath, '/js/**/templates/**/*.js')}`,
    ];

    _.each(globby.sync(glob), (file) => {
      const content = fs.readFileSync(file, { encoding: 'utf-8' });

      // THE SKY IS FALLING.
      // We can actually run this at about 36k operations per second
      // so this is incredibly fast and on par with a massive regex
      // that everyone hates.
      try {
        // eslint-disable-next-line
        eval(content);
      } catch (e) {
        swig.log.error('swig-bundle:examineModules', `An error ocurred while evaluating: ${file.grey}`);
        swig.log.info('', e);
        process.exit(1);
      }

      _.each(evalResults, (result) => {
        result.path = file;

        if (result.targetExperiences) {
          _.each(result.targetExperiences, (experience) => {
            modules[experience].push(result);
          });
        } else {
          modules.all.push(result);
        }

        if (result.bundle) {
          // a module with multiple experiences which declares a bundle
          // will result in dupes, unless we check for it.
          const existing = _.find(bundles, bundle => bundle.name === result.bundle);

          if (!existing) {
            result.dependencies = {};
            result.exclusiveDependencies = [];
            result.name = result.bundle;

            bundles.push(result);
          } else {
            // if it exists, we want to make sure that we have all of the defined deps
            // from the code as well, because a requirejs module could have a dep on a submodule.
            existing.definedDependencies = existing.definedDependencies.concat(
                result.definedDependencies);
          }
        }
      });

      // clear the temporary results container for the next file.
      evalResults = [];
    });

    return bundles;
  }

  function getBundleDependencies(bundle, dependencies) {
    const deps = dependencies || modules.dependencies;

    _.each(deps, (object, moduleName) => {
      // sometimes modules are REALLY REALLY DUMB and like to name their
      // primary require module things like nav.unified.nav instead of
      // nav.unified(.unified). We need to check for that case, sadly.
      let shortName = bundle.moduleName.split('.');
      shortName.splice(-1);
      shortName = shortName.join('.');

      if (bundle.moduleName === moduleName || shortName === moduleName) {
        bundle.dependencies = object.dependencies;
      } else {
        getBundleDependencies(bundle, object);
      }
    });
  }

  function flattenDependencies(dependencies) {
    const deps = dependencies || modules.dependencies;

    _.each(deps, (dep, moduleName) => {
      modules.flatDependencies.push(moduleName);

      flattenDependencies(dep.dependencies);
    });
  }

  function flattenBundleDependencies(bundle, dependencies) {
    const deps = dependencies || bundle.dependencies;

    _.each(deps, (dep, moduleName) => {
      bundle.exclusiveDependencies.push(moduleName);

      flattenBundleDependencies(bundle, dep.dependencies);
    });
  }

  function findExclusiveDependencies(bundle) {
    _.each(bundle.dependencies, (moduleName) => {
      const spokenFor = _.contains(modules.bundles.spokenFor, moduleName);

      if (!spokenFor) {
        modules.bundles.spokenFor.push(moduleName);
        bundle.exclusiveDependencies.push(moduleName);
      }
    });
  }

  function cleanDependencies(dependencies) {
    // these are already present in main.js
    let deps = _.difference(dependencies, [
      '@gilt-tech/internal.require',
      '@gilt-tech/internal.gilt_require',
      '@gilt-tech/internal.json',
      '@gilt-tech/internal.modernizr',
      '@gilt-tech/internal.browser_detect',
      '@gilt-tech/internal.less',
      '@gilt-tech/internal.picturefill'
    ]);

    deps = _.uniq(deps);
    deps = _.sortBy(deps, moduleName => moduleName);

    return deps;
  }

  function findBundleDependencies() {
    _.each(modules.bundles, (bundle) => {
      getBundleDependencies(bundle);

      flattenBundleDependencies(bundle);

      bundle.dependencies = bundle.exclusiveDependencies;
      bundle.dependencies = bundle.dependencies.concat(bundle.definedDependencies);
      bundle.exclusiveDependencies = [];

      bundle.dependencies = cleanDependencies(bundle.dependencies);

      findExclusiveDependencies(bundle);
    });
  }

  function buildBundle(glob, bundleIn) {
    const bundle = bundleIn || { name: 'main' };

    const streams = _.map(['full', 'intermediate', 'minimal'], (experience) => {
      const stream =
        gulp.src(glob, { base: basePublicPath })

          // tell our custom concat plugin to build this main file and check the target
          // experiences in the modules collection var for any experiences for a particular
          // filename/module.

          .pipe(sourcemaps.init({
            loadMaps: true
          }))
          .pipe(concat(`${bundle.name}.${experience}.src.js`, {
            basePath,
            experience,
            modules: modules[experience]
          }))
          .pipe(sourcemaps.write('.'))
          .pipe(gulp.dest(basePath));

      return stream;
    });

    return merge.apply(this, streams);
  }

  gulp.task('bundle-setup', co.wrap(function* () {
    swig.log.task('Building Dependency Graph');

    modules.dependencies = yield getDependencyGraph();

    swig.log.task('Examining Modules for Bundles and Experiences');

    modules.bundles = examineModules();

    // rather than having underscore flatten bundles' exclusive deps for a
    // subsequent check, we'll add any deps that are added to a bundle's
    // exclusive deps to this collection for easy reference.
    modules.bundles.spokenFor = [];

    swig.log.task('Finding Bundled Dependencies');

    findBundleDependencies();

    swig.log.task('Flattening Dependencies');

    // turn the nested tree into a flat array
    flattenDependencies();

    swig.log.task('Cleaning Dependencies');

    // remove duplicates, alphabetize
    modules.flatDependencies = cleanDependencies(modules.flatDependencies);

    swig.log.task('Removing Bundles from Dependencies');

    // remove any deps that match bundles
    modules.flatDependencies = _.reject(modules.flatDependencies, (moduleName) => {
      const result = _.find(modules.bundles, bundle => bundle.moduleName === moduleName);

      return !_.isUndefined(result);
    });

    swig.log.task('Removing Exclusve Bundle Dependencies');

    // remove any deps that are exclusive to a bundle
    modules.flatDependencies = _.reject(modules.flatDependencies, (moduleName) => {
      let result = false;

      _.each(modules.bundles, (bundle) => {
        _.each(bundle.exclusiveDependencies, (depName) => {
          if (moduleName === depName) {
            result = true;
          }
        });
      });

      return result;
    });

    swig.log.task('Writing bundles.js');

    let bundles = {};

    // build a simple mapping object for requireJS to use
    _.each(modules.bundles, (bundle) => {
      _.each(bundle.exclusiveDependencies, (dep) => {
        bundles[dep] = bundle.name;
      });
    });

    bundles = `gilt.bundle(${
              JSON.stringify(bundles, null, 2)
              });\n`;

    fs.writeFileSync(path.join(basePath, 'bundles.js'), bundles);

    // leave this here for debuggin
    // fs.writeFileSync('app-dependencies.json', JSON.stringify(modules.dependencies, null, 2));
    // fs.writeFileSync('app-dependencies-flat.json',
    //  JSON.stringify(modules.flatDependencies, null, 2));
    // fs.writeFileSync('app-bundles.json', JSON.stringify(modules.bundles, null, 2));
  }));

  gulp.task('bundle-bundles', ['bundle-setup'], function () {
    const streams = _.map(modules.bundles, (bundle) => {
      swig.log.task(`Bundling ${bundle.name}`);

      const glob = [];

      // add the module requesting the bundle to the end
      bundle.exclusiveDependencies.push(bundle.moduleName);
      // and mark is as spoken For
      modules.bundles.spokenFor.push(bundle.moduleName);

      // add all of the exclusive bundle deps to the mix
      _.each(bundle.exclusiveDependencies, (moduleName) => {
        const parts = moduleName.split('.');
        let modulePath;

        if (parts.length > 2) {
          // eg. nav.unified.notification > nav/unified/notification.js
          modulePath = parts.join('/');
        } else {
          // eg. vendor.kairos > vendor/kairos/kairos.js
          parts.push(parts[parts.length - 1]);
          modulePath = parts.join('/');
        }

        modulePath = path.join(basePath, `${modulePath}.js`).replace('@gilt-tech/', '');

        glob.push(modulePath);
      });

      return buildBundle(glob, bundle);
    });

    // return a merged stream of all the bundle streams
    // this forces gulp to wait for completion
    return merge.apply(this, streams);
  });

  gulp.task('bundle', ['bundle-bundles'], () => {
    swig.log.task('Bundling Main');

    // put together the main.[exp].src.js bundle
      // save time by just reusing main.js that the `install` task already created.
    const mainPath = path.join(basePath, 'main.js');
    const bundlesPath = path.join(basePath, 'bundles.js');
    const glob = [mainPath, bundlesPath];

    _.each(modules.flatDependencies, (moduleName) => {
      moduleName = moduleName.replace('@gilt-tech/', '');

      const spokenFor = _.contains(modules.bundles.spokenFor, moduleName);
      let modulePath = moduleName.replace(/\./g, '/');

      if (spokenFor) {
        return;
      }

      modulePath = path.join(basePath, modulePath, '/**/*.js');

      glob.push(modulePath);
    });

    // add the app/ directory to the mix
    glob.push(path.join(basePath, '/app/**/*.js'));

    return buildBundle(glob);
  });
};
