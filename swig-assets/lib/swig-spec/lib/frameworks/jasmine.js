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
    jasmine = require('gulp-jasmine-phantomjs'),
    mustache = require('mustache'),
    gutil = require('gulp-util'),

    jasminePath = path.join(path.dirname(require.resolve('gulp-jasmine-phantomjs')), 'vendor/jasmine-1.3.1'),

    runnerPath = path.join(__dirname, '../../templates/jasmine-runner.mustache'),
    runner = fs.readFileSync(runnerPath, 'utf-8'),

    stream;

    swig.log.info('', 'Rendering Runner...\n');

    options = _.extend(options, {
      jasminePath: jasminePath,
      libPath: __dirname
    });

    runner = mustache.render(runner, options);

    swig.log.task('Running Specs with PhantomJS+Jasmine');
    swig.log('');

    stream = file('runner.html', runner, { src: true });

    if (!swig.argv.browser) {
      return stream
        .pipe(gulp.dest(options.runnerPath))
        .pipe(jasmine({
          verbose: options.verbose,
          phantomjs: {
            webSecurityEnabled: false,
            localToRemoteUrlAccessEnabled: true,
            ignoreSslErrors: true
          }
        }));
    }

    return stream;
};
