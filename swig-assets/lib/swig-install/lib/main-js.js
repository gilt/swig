'use strict';
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

// creates main.js
module.exports = function (gulp, swig, paths) {

  // main.js
  var _ = require('underscore'),
    glob = require('glob'),
    path = require('path'),
    fs = require('fs'),
    now = (new Date()).toString(),
    preamble = '/* Generated: '
      + now
      + '\n   This file is auto-generated during ui:install\n   It is inadvisable to write to it directly */\n',
    template = fs.readFileSync(path.join(__dirname, '../templates/main.js'), { encoding: 'utf-8' }),
    files = '',
    destPath,
    pkg,
    configDeps = _.extend({}, swig.pkg.configDependencies),
    config,
    mainjs,
    jsBasePath;

  // pull in raw file contents which need to be inserted into the template
  ['require', 'gilt_require', 'json'].forEach(function (file) {
    var filePath = path.join(paths.js, '/vendor/common/', file + '.js'),
      basename = path.basename(filePath);

    files += '\n// BEGIN: ' + basename + '\n\n' +
              fs.readFileSync(filePath, { encoding: 'utf-8' }) + '\n';
              '\n// END: ' + path.basename(file) + '\n';
  });

  // load the config dependencies
  glob.sync(path.join(swig.temp, '/**/node_modules/@gilt-tech/**/package.json')).forEach(function (file) {
    pkg = JSON.parse(fs.readFileSync(file, { encoding: 'utf-8' }));
    if (pkg.configDependencies) {
      configDeps = _.extend(configDeps, pkg.configDependencies);
    }
    else if (pkg.gilt && pkg.gilt.configDependencies) {
      configDeps = _.extend(configDeps, pkg.gilt.configDependencies);
    }
    else if (pkg.gilt && pkg.gilt.configDefaults) {
      configDeps = _.extend(configDeps, pkg.gilt.configDefaults);
    }
  });

  if (swig.argv.module) {
    // modules don't run from server/browser
    // so their basepath shoud point to where the files are 'installed'
    // this allows their specs to load templates and such using XHR
    jsBasePath = paths.js;
  }
  else {
    jsBasePath = '/a/js/' + swig.pkg.name.replace('@gilt-tech/', '') + '/';
  }

  configDeps['config.jsBasePath'] = configDeps['config.js_base_path'] = jsBasePath;

  // handlebars is overkill here, run with a simple replace.
  mainjs = template
                    .replace('{{preamble}}', preamble)
                    .replace('{{files}}', files)
                    .replace('{{configs}}', JSON.stringify(configDeps || {}, null, '  '));

  destPath = path.join(paths.js, 'main.js');

  swig.log.info('', 'Writing main.js');
  swig.log.verbose(destPath);
  swig.log();

  fs.writeFileSync(destPath, mainjs);
};
