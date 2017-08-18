

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
  const _ = require('underscore');
  const path = require('path');
  const co = require('co');
  const execa = require('execa');
  const split = require('split2');
  const installCommand = swig.argv.useYarn
      ? 'yarn install --json'
      : 'npm install --loglevel=info --parseable=true 2>&1';

  const regex = {
    requested: /npm https? request GET (.+)/,
    installed: /npm info (?:lifecycle )?(.+)~?install:? (@gilt-tech\/(.+)@([\d|.]+))$/,
    error: /npm ERR! code (.+)/,
    fourohfour: /npm ERR! 404 Not found : (@gilt-tech\/.+)/,
    noversion: /npm ERR! No compatible version found: (.+)/,
    yarnModule: /@gilt-tech\/(.+)@~?\^?([\d|.|*]+)/
  };
  const downloaded = [];

  swig.tell('install', { description: 'Installs and organizes Gilt front-end assets. aka. ui-install' });

  function processYarnLine(line) {
    if (!line) return;
    let moduleName;
    const l = JSON.parse(line);
    if (l.type === 'step') swig.log.info(null, l.data.message);
    if (l.type === 'activityTick') {
      if (regex.yarnModule.test(l.data.name)) {
        moduleName = l.data.name.replace(regex.yarnModule, '$1 v$2');

        if (!_.contains(downloaded, moduleName)) {
          downloaded.push(moduleName);

          swig.log(`${swig.log.strip(swig.log.symbols.download).green}  ${moduleName}`);
        }
      }
    }
  }

  // processes output from npm install commands
  function processNpmLine(line) {
    if (swig.argv.useYarn) {
      try {
        processYarnLine(line);
      } catch (e) {
        // NOTE: Some output lines come joined together. Splitting them here
        // and processing them one by one.
        if (/\n/.test(line)) {
          const lines = line.split(/\n/);
          lines.forEach((_line) => {
            processYarnLine(_line);
          });
        }
      }
      return;
    }

    line = swig.log.strip(line).trim();

    swig.log.verbose(line);

    let moduleName;

    if (regex.requested.test(line)) {
      moduleName = line.replace(regex.requested, '$1');

      swig.log.verbose(`${swig.log.padding + swig.log.padding + '→'.white}  ${moduleName}`);
    } else if (regex.installed.test(line)) {
      moduleName = line.replace(regex.installed, '$3 v$4');

      if (!_.contains(downloaded, moduleName)) {
        downloaded.push(moduleName);

        swig.log(`${swig.log.strip(swig.log.symbols.download).green}  ${moduleName}`);
      }
    } else if (regex.fourohfour.test(line)) {
      swig.log();
      swig.log.error('install', `Module not found: ${line.replace(regex.fourohfour, '$1')}`);
    } else if (regex.noversion.test(line)) {
      swig.log();
      swig.log.error('install', line.replace(regex.noversion, '$1'));
      swig.log('\nTry specifying a different version. use `npm view <module>` to display available versions for a module.\n');
    } else if (regex.error.test(line)) {
      swig.log();
      swig.log.error('install', line.replace(regex.error, '$1'));
    }
  }

  function* local() {
    if (swig.argv.module || swig.argv.skipNpmInstall) {
      swig.log.info('', 'Skipping Node Modules');
      return;
    }

    const pkg = swig.pkg;

    swig.log();
    swig.log.task('Installing Node Modules');

    if (!pkg.dependencies || _.isEmpty(pkg.dependencies)) {
      swig.log.warn(null, 'package.json doesn\'t contain any dependencies, nothing to install.\n');
      return;
    }

    const installProcess = execa.shell(installCommand, {
      preferLocal: false
    });
    installProcess.stdout.pipe(split()).on('data', (line) => {
      processNpmLine(line);
    });

    const result = yield installProcess;

    if (!downloaded.length) {
      swig.log.info(null, 'Node Modules are up to date.');
    }

    if (result.stdout.indexOf('not ok') > -1 || result.stdout.indexOf('ERR!') > -1) {
      swig.log.error('install:local', `One or more modules failed to install from npm.\n ${
        swig.log.padLeft(`For more info, look here: ${path.join(swig.target.path, 'npm_debug.log').grey}`, 7)}`);
    }
  }

  function* ui() {
    const pkg = swig.pkg;

    swig.log();
    swig.log.task('Installing Gilt UI Dependencies');

    if (!swig.argv.module && (!pkg.gilt || !pkg.gilt.uiDependencies)) {
      swig.log.warn(null, 'package.json doesn\'t contain any uiDependencies, nothing to install.\n');
      return;
    }

    const commands = [
      `cd ${swig.temp}`,
      'rm package-lock.json',
      'rm -rf node_modules',
      installCommand + (swig.argv.useYarn ? ' --no-lockfile' : '')
    ];

    const installProcess = execa.shell(commands.join('; '), {
      preferLocal: false
    });
    installProcess.stdout.pipe(split()).on('data', (line) => {
      processNpmLine(line);
    });

    const result = yield installProcess;

    if (result.stdout.indexOf('not ok') > -1 || result.stdout.indexOf('ERR!') > -1) {
      swig.log.error('install:ui', `One or more modules failed to install from npm.\n ${
        swig.log.padLeft(`For more info, look here: ${path.join(swig.temp, 'npm_debug.log').grey}`, 7)}`);
    }
  }

  // this is a plain old noop task for conditionally executing install.
  gulp.task('install-noop', (done) => {
    done();
  });

  gulp.task('install', co.wrap(function* () {
    if (!swig.pkg) {
      swig.log.error('install', 'Couldn\'t find package.json, not installing anything.');
      return;
    }

    const processPublic = require('./lib/public-directory')(gulp, swig);
    const packageMerge = require('./lib/package-merge')(gulp, swig);
    const mergeModules = require('./lib/merge-modules')(gulp, swig);

    packageMerge();
    yield local();
    yield ui();
    mergeModules();
    processPublic();
  }));
};
