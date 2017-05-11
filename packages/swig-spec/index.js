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

module.exports = function (gulp, swig) {
  if (!swig.pkg) {
    return;
  }

  const _ = require('underscore');
  const fs = require('fs');
  const path = require('path');
  const glob = require('globby');
  const concat = require('gulp-concat');
  const tap = require('gulp-tap');
  const wrap = require('gulp-wrap');
  let scripts = [];
  const fixtures = [];
  const packageName = _.isEmpty(swig.pkg) ? '' : swig.pkg.name.replace('@gilt-tech/', '');
  let specsPath = '';
  let tempPath = '';
  let requireBasePath = '';
  let servers; // populated by mock-apidoc task

  swig.tell('spec', {
    description: 'Runs specs (tests, expectations) for UI Modules and web apps.',
    flags: {
      '--module, --m': 'Specifies the target module to run specs for, within the working directory.\nIf not specified, the task assumes the working directory is a web app.',
      '--targetExperience': 'Optional. The target experience to run specs for;\nfull, intermediate, or minimal',
      '--browser': 'Optional. Opens the specs in a browser window instead of running them in the console.',
      '--verbose': 'Optional. Shows additional infomration on the process, including console output from PhantomJS.',
      '--src': 'Specify the public folder'
    }
  });

  function getSrcDirectory(){
    return swig.argv.src || `${swig.target.path}/public`;
  }

  // Loading swig dependencies
  swig.loadPlugins(require('./package.json').dependencies);

  gulp.task('spec-setup', (done) => {
    const srcPath = getSrcDirectory();

    swig.log.task('Initializing Specs');

    swig.log.info('', 'Enumerating Dependencies...');

    // add main.js to the mix.
    let mainJsPath = path.join(srcPath, '/js/', packageName, 'main.js');

    // main.js is created in the system tempdir for modules.
    if (swig.project.type !== 'webapp') {
      mainJsPath = path.join(swig.temp, 'install', packageName, 'public/js', packageName, 'main.js');
    }

    scripts.push(mainJsPath);

    specsPath = path.join(srcPath, '/spec/', packageName);
    requireBasePath = path.join(srcPath, '/js/', packageName);

    if (swig.project.type !== 'webapp') {
      // if we're in a ui-* modules repo
      tempPath = path.join(swig.temp, 'install', packageName);
      specsPath = path.join(swig.target.path, 'spec/');
      requireBasePath = path.join(tempPath, 'public/js', packageName);

      // what we're doing here is telling require to use the files local to /js
      // for the module first, rather than what's in the temp ui-install dir.
      scripts = scripts.concat(glob.sync(path.join(swig.target.path, 'js/**/*.js')));
    }

    // load any fixtures in /specs/fixtures
    gulp
      .src(path.join(specsPath, '/fixtures/**/*.json'))
      .pipe(tap((file) => {
        try {
          const json = JSON.parse(file.contents);
          // condense the fixture to a single line, unless --verbose is used
          fixtures.push({
            name: path.basename(file.path).replace(path.extname(file.path), ''),
            fixture: swig.argv.verbose ? JSON.stringify(json, null, 2) : JSON.stringify(json)
          });
        } catch (e) {
          console.log(e);
        }
      }))
      .on('end', done);
  });

  gulp.task('spec-mock-apidoc', ['spec-setup'], (done) => {
    swig.log.info('', 'Enumerating Mock API (apidoc)');

    const mock = require('./lib/mock-apidoc.js');

    gulp.src(path.join(swig.target.path, '/json/mock/**/*.json'))
      .pipe(mock())
      .pipe(tap((file) => {
        try {
          const fileServers = JSON.parse(file.contents);
          servers = _.filter(_.union(servers, fileServers), a => typeof a !== 'undefined');
        } catch (e) {
          console.log(e);
        }
      }))
      .on('end', done);
  });

  gulp.task('spec-templates', ['spec-mock-apidoc'], (done) => {
    const srcPath = getSrcDirectory();

    swig.log.info('', 'Enumerating Templates...');

    const handlebars = require('handlebars');
    let hbsPath = path.join(srcPath, '/templates/', packageName, 'src');
    let destPath = path.join(srcPath, '/spec/', packageName, '/runner');
    let tmp;
    let fileCount = 0;
    let hbsGlob = [];

    if (swig.project.type !== 'webapp') {
      hbsPath = path.join(swig.target.path, 'templates');
      destPath = path.join(swig.target.path, 'spec/runner');

      // it's a bit wonky for modules, but follows webapp structure
      tmp = path.join(swig.temp, 'install', swig.argv.module, 'public/templates/', swig.argv.module);
    }

    hbsGlob = [
      path.join(hbsPath, '/**/*.handlebars'),
      `!${path.join(hbsPath, '/**/dom.chassis/*.handlebars')}`,
      `!${path.join(hbsPath, '/**/nav.unified/*.handlebars')}`,
      `!${path.join(hbsPath, '/**/nav.footer/*.handlebars')}`
    ];

    if (swig.project.type !== 'webapp') {
      hbsGlob.push(
        // plus all the templates from all the dependencies
        path.join(tmp, '/**/*.handlebars'),
        // except for 'this' module's templates, because we want easy live editing.
        `!${path.join(tmp, swig.argv.module.split('.')[0], '/**/*.handlebars')}`
      );
    }

    gulp.src(hbsGlob)
      .pipe(tap((file) => {
        const contents = file.contents.toString();
        const ast = handlebars.parse(contents);
        let compiled = handlebars.precompile(ast, {}).toString();
        const basePath = path.join(path.dirname(file.path), '/../../');
        let fileName = path.basename(file.path, path.extname(file.path));
        let moduleName = packageName.replace(/\./g, '/');

        // if we're dealing with a template from the temp install path
        if (basePath.indexOf('/var') === 0) {
          moduleName = file.path
                           .replace(basePath, '')
                           .replace(`/${path.basename(file.path)}`, '')
                           .trim('/');
        }

        if (swig.project.type === 'webapp') {
          moduleName = 'src';
          fileName = file.path.replace(hbsPath, '');
          fileName = fileName.replace(path.extname(fileName), '').substring(1);
        }

        compiled = compiled.split('\n').join('\n    ');

        file.contents = new Buffer(
          `\n  Handlebars.templates['${moduleName}/${fileName}'] = Handlebars.template(\n    ${
          compiled
          }\n  );`,
          'utf-8'
        );

        fileCount++;
      }))
      .pipe(concat('templates.js'))
      .pipe(wrap({ src: path.join(__dirname, '/templates/handlebars-template.lodash') }))
      .pipe(gulp.dest(destPath))
      .on('end', () => {
        if (fileCount > 0) {
          scripts.push(path.join(destPath.replace('@gilt-tech/', ''), 'templates.js'));
        }
        done();
      });
  });

  gulp.task('spec-run', ['spec-templates'], () => {
    const defaultFramework = 'jasmine';
    const specs = [];
    const runnerPath = path.join(specsPath, '/runner');
    let framework = defaultFramework;
    let impl;
    let options = {};
    let specFiles = [];


    if (!fs.existsSync(runnerPath)) {
      fs.mkdirSync(runnerPath);
    }

    swig.log.info('', `Specs Running From: ${runnerPath.grey}`);

    if (swig.pkg.gilt && swig.pkg.gilt.specs && swig.pkg.gilt.specs.framework) {
      framework = swig.pkg.gilt.specs.framework;
    }

    try {
      swig.log.info('', `Loading ${framework}...`);

      impl = require(`./lib/frameworks/${framework.toLowerCase()}`);
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
        swig.log.error('spec', `Spec Library: ${framework}, hasn't been implemented.`);
        swig.log(e);
      } else {
        throw e;
      }
    }

    swig.log.info('', 'Enumerating Specs...');

    // enum all of the files in the specs directory
    specFiles = glob.sync(path.join(specsPath, '/**/*.js'));

    // the file names should correspond with the name of the module used in gilt.define
    // this is used to `require` the test files and THEN launch mocha/jasmin/other
    _.each(specFiles, (file) => {
      specs.push(`'${path.basename(file, path.extname(file))}'`);
    });

    options = {
      baseUrl: requireBasePath,
      fixtures: fixtures,
      runnerPath: runnerPath,
      scripts: scripts,
      servers: servers,
      specs: specs.join(','),
      specsPath: specsPath,
      specFiles: specFiles,
      targetExperience: swig.argv.targetExperience || 'full',
      useColors: (swig.argv.pretty !== 'false'),
      verbose: Boolean(swig.argv.verbose || false)
    };

    // fire our specs implementation (jasmine, mocha, etc..)
    const stream = impl(gulp, swig, options).on('error', () => {
      swig.log.error('specs-run', 'The specs were unsuccessfully run. Please see the console output above.');
      swig.log.error('specs-run', 'Rerun with the --verbose option if no errors appear.');
      swig.log.error('specs-run', `You may also debug in a browser by opening: ${runnerPath.grey}`);
      process.exit(1);
    });

    if (swig.argv.browser) {
      const open = require('open');
      open(`file://${path.join(runnerPath, 'runner.html')}`);

      swig.log.warn('', 'Skipping specs run, opening specs in browser.');
    }

    return stream;
  });

  gulp.task('spec', function (done) {
    const srcPath = getSrcDirectory();
    let _specsPath = path.join(swig.target.path, srcPath, '/spec/', packageName);
    let installTask = 'install-noop';

    if (swig.project.type !== 'webapp') {
      // if we're in a ui-* modules repo
      _specsPath = path.join(swig.target.path, 'spec/');
    }

    if (swig.argv.module || swig.argv.m) {
      // tell `install` that we need devDependencies too. this needs to be executed BEFORE install.
      swig.argv.devDependencies = true;
      installTask = 'install';
    }
    const specTasks = [installTask, 'lint'];

    if (!(swig.argv.module || swig.argv.m) && swig.tasks['transpile-scripts']) {
      specTasks.push('transpile-scripts');
    }

    if (!fs.existsSync(_specsPath)) {
      specTasks.push(
        () => {
          swig.log.task('Imagining That Specs Exist');
          swig.log.info('', 'Aw boo. No specs to run!');

          done();
        }
      );
      swig.seq.apply(this, specTasks);

      return;
    }
    specTasks.push('spec-run');
    specTasks.push(done);


    swig.seq.apply(this, specTasks);
  });
};
