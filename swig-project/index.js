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

var _ = require('underscore'),
  path = require('path'),
  os = require('os'),
  fs = require('fs'),
  gulp = require('gulp'),
  argv = require('yargs').argv,
  taskName = argv._.length > 0 ? argv._[0] : 'default',
  swig = {
    gulp: gulp,
    argv: argv,
    project: {}
  };

function load (moduleName) {

  if (argv.verbose) {
    console.log('Loading: ' + moduleName);
  }

  var module = require(moduleName)(gulp, swig) || {};

  module.path = path.dirname(require.resolve(moduleName));
  module.pkg = require(path.join(module.path, '/package.json'));

  try {
    module.swigInfo = require(path.join(module.path, '/swig.json'));
  }
  catch (e) {
    if (e.code != 'MODULE_NOT_FOUND') {
      throw e;
    }
  }

  return module;
}

function setupPaths () {
  var fs = require('fs'),
    path = require('path'),
    swigPath = path.join(process.env.HOME, '.swig');

  if (!fs.existsSync(swigPath)) {
    fs.mkdirSync(swigPath);
  }

  swig.home = swigPath;
  swig.cwd = process.cwd();
  swig.temp = path.join(os.tmpdir(), 'swig');
}

function findTarget () {

  var target,
    moduleName,
    repo = swig.argv.repo || '';

  if(swig.argv.module) {
    target = path.join('src', swig.argv.module.replace(/\./g, '/'));

    if (repo) {
      target = path.join('/web/', repo, target);
    }
    else {
      target = path.join(swig.cwd, target);
    }

    swig.project.type = 'module';
  }
  else {
    target = repo ? path.join('/web/', repo) : swig.cwd;

    swig.project.type = 'webapp';
  }

  swig.target = target;
}

function findPackage () {

  var packagePath = path.join(swig.target, 'package.json')

  if (fs.existsSync(packagePath)) {
    swig.pkg = require(packagePath);
  }
  else {
  //   packagePath = swig.fs.findup('package.json', {cwd: swig.target, nocase: true});
  //   if (fs.existsSync(packagePath)) {
  //     swig.pkg = require(packagePath);
  //     swig.target = path.dirname(packagePath);
  //   }
    // else {
      swig.log('swig.util: package.json not found at: ' + packagePath);
    // }
  }
}

swig.util = require('swig-util')(swig);
swig.log = require('swig-log')(swig);

setupPaths();
findTarget();
findPackage();

// create swigs's temporary directory;
if (!fs.existsSync(swig.temp)) {
  fs.mkdirSync(swig.temp);
}

swig = _.extend(swig, {
  tools: {
    app: load('swig-app'),
    'app-registry': load('swig-app-registry'),
    tunnel: load('swig-tunnel'),
    zk: load('swig-zk')
  }
});

// if the requested task is a tool, stop loading things.
if (_.has(swig.tools, taskName)) {
  return swig;
}

swig = _.extend(swig, {
  tasks: {
    'default': load('swig-default'),
    install: load('swig-install'),
    lint: load('swig-lint')
  }
});

module.exports = swig;
