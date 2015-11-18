#!/usr/bin/env node

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

var fs = require('fs'),
  path = require('path'),
  exec = require('child_process').exec,
  execOpts = {
    maxBuffer: 500*1024       // default is 200*1024
  },
  npmInstallError = null,
  templates = {
    gulpfile: fs.readFileSync(path.join(__dirname, '../templates/gulpfile.js')),
    pkg: fs.readFileSync(path.join(__dirname, '../templates/package.json'))
  },
  paths = {
    gulpfile: path.join(process.cwd(), 'gulpfile.js'),
    pkg: path.join(process.cwd(), 'package.json')
  },
  pkg;

require('colors');

console.log('\nSwig is about to make your project funky fresh...'.cyan);

if (fs.existsSync(paths.gulpfile)) {
  console.log('You\'re already fresh. Get funky and add the following to your gulpfile.js:\n'.yellow);
  console.log(templates.gulpfile + '\n');
}
else {
  console.log('Creating a gulpfile for great justice.');
  fs.writeFileSync(paths.gulpfile, templates.gulpfile);
}

if (fs.existsSync(paths.pkg)) {
  console.log('I spy an existing project. Spicing up your package.json with the Swig deps...'.yellow);
  pkg = require(paths.pkg);
  if (!pkg.devDependencies) {
    pkg.devDependencies = {};
  }
  if (!pkg.devDependencies.gulp) {
    pkg.devDependencies.gulp = '*';
    fs.writeFileSync(paths.pkg, JSON.stringify(pkg, null, 2));
  }
  if (!pkg.devDependencies['@gilt-tech/swig']) {
    pkg.devDependencies['@gilt-tech/swig'] = '*';
    fs.writeFileSync(paths.pkg, JSON.stringify(pkg, null, 2));
  }
}
else {
  console.log('Creating a package.json for great justice.');
  fs.writeFileSync(paths.pkg, templates.pkg);
}

console.log('Running npm install...'.yellow);

// run ui install
var cp = exec('npm install --loglevel=warn 2>&1', execOpts, function (error, stdout, stderr){
  if (error) {
    npmInstallError = error.toString();
  }
});

cp.on('close', function () {
  if (npmInstallError !== null) {
    console.log(('Swig initialization failed on npm install. ' + npmInstallError).red);
  } else {
    console.log('Swig initialization is complete. Feel free to make loud animal noises.'.green);
  }
});

(function capture (stdout) {
  var buff = '';
  stdout.on('data', function (data) {
    buff += data.toString('utf8');

    if (buff.indexOf('\n') > -1) {
      console.log('  ' + buff.trim());
      buff = '';
    }
  });
})(cp.stdout);