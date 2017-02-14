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

module.exports = function (log) {
  var _ = require('underscore'),
    path = require('path'),
    fs = require('fs'),
    glob = require('globby'),
    mustache = require('mustache'),

    cwd = process.cwd(),
    targetPath = 'js',
    encoding = 'utf-8',

    template = fs.readFileSync(path.join(__dirname, '../../templates/vendor.mustache'), encoding),
    files;

  log();
  log.task('Wrapping Vendor Module');

  files = glob.sync([path.join(cwd, targetPath, '**/*.js')]);

  if (!files.length) {
    log.info('', 'No files to wrap!');
    return;
  }

  files.forEach(function (filePath) {
    var data = {
        contents: fs.readFileSync(filePath, encoding)
      },
      pkg = require(path.join(cwd, 'package.json')),
      output;

    data.name = pkg.name.replace('@gilt-tech/', '');
    data.global = pkg.global_var /* legacy */ || pkg.gilt.globalVar || data.name.split('.')[1];

    log.info('', 'Rendering:' + filePath.grey);

    output = mustache.render(template, data);

    fs.writeFileSync(filePath, output, encoding);
  });
};
