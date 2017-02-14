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

module.exports = function (gulp, swig, options) {

  var _ = require('underscore'),
    file = require('gulp-file'),
    fs = require('fs'),
    path = require('path'),
    mocha = require('gulp-mocha-phantomjs'),
    mustache = require('mustache'),
    gutil = require('gulp-util'),

    mochaPath = path.dirname(require.resolve('mocha')),

    // we have to reference this reporter by file path rather than name
    // due to a compliation problem with the Prototype
    nyanPath = path.join(mochaPath, '/lib/reporters/nyan.js'),

    chaiPath = path.dirname(require.resolve('chai')),
    runnerTemplatePath = path.join(__dirname, '../../templates/mocha-runner.mustache'),
    runner = fs.readFileSync(runnerTemplatePath, 'utf-8'),

    stream;

    swig.log.info('', 'Rendering Runner...\n');

    options = _.extend(options, {
      mochaPath: mochaPath,
      chaiPath: chaiPath,
      libPath: __dirname
    });

    runner = mustache.render(runner, options);

    swig.log.task('Running Specs with PhantomJS+Mocha');
    swig.log('');

    stream = file('runner.html', runner, { src: true });

    if (!swig.argv.browser) {
      return stream
        .pipe(gulp.dest(options.runnerPath))
        .pipe(mocha({
          reporter: nyanPath,
          phantomjs: {
            webSecurityEnabled: false,
            localToRemoteUrlAccessEnabled: true,
            ignoreSslErrors: true
          }
        }));
    }

    return stream;
};
