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
*/

// handles building of the /public assets directory
module.exports = function (gulp, swig) {
  const _ = require('underscore');
  const fs = require('fs');
  const glob = require('globby');
  const rimraf = require('rimraf');
  const path = require('path');

  const modules = {};
  let azModules = []; // alphabetically sorte;
  let now;

  // remove everything in /public except for /public/src and /public/main.less
  function clean() {
    swig.log.info('', 'Cleaning the /public directory...');

    let paths = [
      './public/**/{target}/**/*',
      '!./public/**/{target}/**/config',
      '!./public/**/{target}/**/config/**/*',
      '!./public/**/{target}/**/src',
      '!./public/**/{target}/**/src/**/*',
      '!./public/css/{target}/main.less',
      '!./public/spec/{target}/**/*',
      '!./public/vue-assets/**/*'
    ];

    paths = _.map(paths, p => p.replace('{target}', swig.pkg.name));
    const files = glob.sync(paths);

    swig.log.verbose(`[clean] ${files.length} files found at: `);
    swig.log.verbose(paths);

    _.each(files, (file) => {
      swig.log.verbose(`[clean] removing: ${file}`);
      rimraf.sync(path.normalize(file));
    });
  }

  // find and compile a list of all unique modules, and their paths
  function compile() {
    swig.log.info('', 'Compiling module list...');

    const modulesPath = path.join(swig.temp, '/**/node_modules/@gilt-tech');
    const modPaths = glob.sync(modulesPath);
    let dirs;

    swig.log.verbose(`[compile] searching: ${modulesPath}`);
    swig.log.verbose(`[compile] found module directories: ${modPaths.length}`);

    modPaths.forEach((modPath) => {
      swig.log.verbose(`[compile] compiling: ${modPath}`);

      dirs = fs.readdirSync(modPath);

      _.each(dirs, (dir) => {
        const dirPath = path.join(modPath, dir);
        if (fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory()) {
          azModules.push({ name: dir, path: dirPath });
        }
      });
    });

    // group by basename, and take the 'topmost' module in the hierarchy
    azModules = _.groupBy(azModules, module => path.basename(module.path));

    // pull out the 'winning' module path, for each module
    azModules = _.map(azModules, (modulesList) => {
      // the modules arg will be [{ name:, path: }, ...]

      if (modulesList.length === 1) {
        return modulesList[0];
      }

      // glob will almost always return the right order,
      // but let's assert this to be safe. we can spare the cycles.
      return _.sortBy(modulesList, module => module.path.length)[0];
    });

    // and now we pretty sort a-z for various output
    // we dont reset azModules to the sorted array because we need it dirty for deps.less
    _.sortBy(azModules, mod => mod.name).forEach((mod) => {
      modules[mod.name] = mod.path;
    });

    swig.log.verbose('[compile] sorted modules: ');
    swig.log.verbose(modules);
  }

  function copy(paths) {
    let destPath;
    let sourcePath;
    let modPathName;

    if (swig.argv.module) {
      swig.log.info('', `Copying ${swig.argv.module} to temp...`);

      destPath = path.join(swig.temp, 'node_modules', swig.argv.module);
      sourcePath = path.join(swig.target.path);

      swig.fs.copyAll(sourcePath, destPath);
      modules[swig.argv.module] = destPath;
    }

    swig.log.info('', 'Copying modules to /public...');
    swig.log.verbose('');

    _.each(modules, (modPath, name) => {
      modPathName = name.replace(/\./g, '/');

      _.each(paths, (p, pathName) => {
        sourcePath = path.join(modPath, pathName);

        swig.log.verbose(`\n[copy] copying: ${sourcePath}`);

        if (fs.existsSync(sourcePath)) {
          destPath = path.join(p, modPathName);

          if (fs.existsSync(destPath)) {
            rimraf.sync(destPath);
          }

          swig.fs.mkdir(destPath);
          swig.fs.copyAll(sourcePath, destPath);
          swig.log.verbose(`[copy] copied: ${destPath}`);
        }
      });
    });
  }

  function manifest(paths) {
    // re-prep the modules hash with version numbers instead of paths
    const manifestPath = path.join(paths.js, 'manifest.json');
    let pkg;

    _.each(modules, (mod, name) => {
      pkg = require(path.join(mod, '/package.json'));
      modules[name] = pkg.version;
    });

    swig.log.info('', 'Writing manifest.json');
    swig.log.verbose(manifestPath.grey);

    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          generated: now,
          dependencies: modules
        },
        null,
        2
      )
    );
  }

  function replace(paths) {
    swig.log.info('', 'Replacing Public Repo Name in CSS...');

    glob.sync(path.join(paths.css, '/**/*.css')).forEach((file) => {
      let content = fs.readFileSync(file, { encoding: 'utf-8' });
      const matches = content.match(/\$\$PUBLIC_REPO_NAME\$\$/g);

      if (matches && matches.length) {
        content = content.replace(/\$\$PUBLIC_REPO_NAME\$\$/g, swig.pkg.name);
        fs.writeFileSync(file, content);
        swig.log.verbose(swig.log.padLeft(file, 2));
      }
    });
  }

  function vendor(paths) {
    let destPath;

    swig.log.info('', 'Copying internal modules to vendor/common...');

    glob.sync(path.join(paths.js, '/internal/**/*.js')).forEach((file) => {
      destPath = path.join(paths.js, '/vendor/common/', path.basename(file));

      if (!fs.existsSync(path.dirname(destPath))) {
        swig.fs.mkdir(path.dirname(destPath));
      }

      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }

      fs.linkSync(file, destPath);
    });

    swig.log.info('', 'Copying less helpers common/helpers...');

    glob.sync(path.join(paths.css, '/less/helpers/*.less')).forEach((file) => {
      destPath = path.join(paths.css, '/common/helpers/', path.basename(file));

      if (!fs.existsSync(path.dirname(destPath))) {
        swig.fs.mkdir(path.dirname(destPath));
      }

      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }

      fs.linkSync(file, destPath);
    });
  }

  return function process() {
    now = new Date().toString();
    const pkg = swig.pkg;
    const less = require('./less');
    const mainJs = require('./main-js');
    let paths;
    if (swig.argv.public) {
      if (!fs.existsSync(swig.argv.public)) {
        // Gonna error on a directory that does not exist
        swig.log.error(
          'install:public-directory',
          `Passed target folder ${swig.argv.public} does not exist.`
        );
        return;
      }
      paths = { pub: swig.argv.public };
    } else if (pkg.gilt && pkg.gilt.publicPath) {
      paths = { pub: pkg.gilt.publicPath };
    } else {
      paths = { pub: path.join(swig.target.path, '/public') };
    }
    let packageName;

    // we may have tasks for ui-* repos which need an install.
    // so let's install, but keep everything in a temp directory
    if (swig.argv.module) {
      paths.pub = path.join(swig.temp, 'install', swig.argv.module, 'public');
    }

    if (pkg.name) {
      packageName = pkg.name.replace('@gilt-tech/', '');
      paths = {
        css: path.join(paths.pub, '/css/', packageName),
        img: path.join(paths.pub, '/img/', packageName),
        js: path.join(paths.pub, '/js/', packageName),
        templates: path.join(paths.pub, '/templates/', packageName)
      };
    } else {
      swig.log.error('install:public-directory', 'package.json is missing the "name" property.');
      return;
    }

    swig.log();
    swig.log.task('Processing node_modules → /public');

    clean();
    compile();
    copy(paths);
    manifest(paths);
    less(gulp, swig, paths, azModules);
    replace(paths);
    vendor(paths);
    mainJs(gulp, swig, paths);
  };
};
