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

const path = require('path');
const less = require('gulp-less');
const rename = require('gulp-rename');
const sourcemaps = require('gulp-sourcemaps');
const postcss = require('gulp-postcss');
const inlineImports = require('postcss-import');
const autoprefixer = require('autoprefixer');
const through2 = require('through2');

const autoprefixerCfg = {
  // https://github.com/postcss/autoprefixer#options
  browsers: [
    'last 2 versions',
    'ie >= 10',
    'iOS >= 8'
  ],
  // should Autoprefixer [remove outdated] prefixes. Default is true.
  remove: true
};
const postcssPlugins = [
  inlineImports,
  autoprefixer(autoprefixerCfg),
];


module.exports = function (gulp, swig) {
  const basePath = path.join(swig.target.path, '/public/');
  const cssPath = path.join(basePath, '/css/', swig.target.name);
  const setupWatcher = () => {
    if (!swig.watch.enabled) return null;

    swig.watch.watchers = [...swig.watch.watchers, {
      path: path.join(cssPath, 'src', '/**/*.{css,less}'),
      task: 'merge-css'
    }];
  };

  gulp.task('init-styles', ['merge-css'], setupWatcher);

  gulp.task('merge-css', () => {
    swig.log('');
    swig.log.task('Merging LESS and CSS Files');

    const glob = [
      path.join(cssPath, '/*.{less,css}'),
      // exclude src or min files that have already been merged
      `!${path.join(cssPath, '/*.{min,src}.{less,css}')}`
    ];

    return gulp.src(glob)
      .pipe(sourcemaps.init({
        loadMaps: true
      }))
      .pipe(less({
        paths: [cssPath],
        relativeUrls: false
      }))
      .pipe(postcss(postcssPlugins))
      .pipe(rename({ suffix: '.src' }))
      .pipe(sourcemaps.write('.'))
      .pipe(gulp.dest(cssPath))
      .pipe(swig.watch.browserSync ? swig.watch.browserSync.stream({ match: '**/*.css' }) : through2.obj());
  });
};
