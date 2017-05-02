

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

  // TODO:
  // module name
  // js and less dependencies
  // merge conflict markers /^[<>=]{7}/ + file names snake_case, no hypens
  // console.log /console\.(log|debug|info|warn|error)\(/

  // /
  //   createModule
  //   \s*\(\s*      # begin method params
  //   (?:
  //     \{\s*
  //       (?:global\s*:\s*["'][\w\$]+["']\s*,\s*)?
  //       amd\s*:\s*
  //         ("|')         # open quote around module name
  //           ([\w\.\/]+) # module name
  //         \1            # close quote
  //       (?:\s*,\s*global\s*:\s*["'][\w\$]+["'])?
  //     \s*\}
  //   |
  //     ("|')         # open quote around module name
  //       ([\w\.\/]+) # module name
  //     \3            # close quote
  //   )
  //   \s*,\s*
  // /x

const eslint = require('gulp-eslint');
const fs = require('fs');
const path = require('path');

module.exports = function lintersSetup(gulp, swig) {
  if (!swig.pkg) {
    return;
  }

  swig.tell('lint', { description: 'Lints Gilt front-end assets.' });

  let paths;

  gulp.task('lint-setup', (done) => {
    let baseName;
    let baseSource;
    let publicPath;

    function source(type, extension) {
      return baseSource
        .replace(/\{type\}/g, type)
        .replace(/\{extension\}/g, extension);
    }

    if (swig.project.type === 'webapp') {
      baseName = path.basename(swig.target.path);
      if (swig.argv.src) {
        publicPath = swig.argv.src;
      } else if (swig.pkg.gilt && swig.pkg.gilt.publicPath) {
        publicPath = swig.pkg.gilt.publicPath;
      } else {
        publicPath = swig.target.path + '/public';
      }
      baseSource = path.join(publicPath, '/{type}/', baseName, '/src/**/*.{extension}');
    } else {
      baseSource = path.join(swig.target.path, '/**/*.{extension}');
    }

    paths = {
      js: source('js', '{js,jsx}'),
      css: source('css', '{css,less}'),
      templates: source('templates', 'handlebars')
    };

    // we never want to lint reset.less|css files since they'll almost always have linting errors
    if (swig.project.type === 'webapp') {
      paths.css = [
        paths.css,
        `!${path.join(publicPath,
          'css/',
          baseName,
          '/src/**/reset.{css,less}'
        )}`
      ];
    }

    // some hacky shit so that package-version task can be loaded
    // normally from another file, but still have access to this.
    // minor minor namespace pollution for simplicity. please don't follow this pattern.
    // eslint-disable-next-line
    swig.linter = { paths: paths };

    done();
  });

  // load some of our misc linting tasks
  require('./lib/tasks/package-version')(gulp, swig);
  require('./lib/tasks/old-require')(gulp, swig);

  gulp.task('lint-script', ['lint-setup'], () => {
    swig.log.task('Linting Javascript', { noNewline: true });

    const failReporter = require('./lib/reporters/eslint-fail-reporter')(gulp, swig);
    const eslintrc = path.join(process.cwd(), '.eslintrc.yml');
    if (!fs.existsSync(eslintrc)) {
      swig.log('You do not seem to have an .eslintrc.yml configuration in your app folder.');
      swig.log('Please create such file and add the following to it:');
      swig.log('');
      swig.log('parser: "babel-eslint"');
      swig.log('extends: "@gilt-tech/eslint-config-gilt-base"');
      swig.log('');
      swig.log('Also run the following command:');
      swig.log('');
      swig.log('npm i -D eslint babel-eslint eslint-plugin-import eslint-plugin-jsx-a11y eslint-plugin-react @gilt-tech/eslint-config-gilt');

      process.exit(1);
    }

    return gulp.src([
      paths.js,
      `!${path.dirname(paths.js)}/runner/**/*.*`
    ])
    .pipe(eslint(eslintrc))
    .pipe(eslint.format('node_modules/eslint-codeframe-formatter'))
    .pipe(failReporter());
  });

  gulp.task('lint-css', ['lint-setup'], () => {
    swig.log.task('Linting CSS and LESS');

    if (swig.argv.useStylelint) {
      const stylelintrc = path.join(process.cwd(), '.stylelintrc.yml');
      if (!fs.existsSync(stylelintrc)) {
        swig.log('You do not seem to have a .stylelintrc.yml configuration in your app folder.');
        swig.log('Please create such file and add the following to it:');
        swig.log('');
        swig.log('extends: "stylelint-config-standard"');
        swig.log('');
        swig.log('Also run the following command:');
        swig.log('');
        swig.log('npm i -D stylelint stylelint-config-standard');

        process.exit(1);
      }

      const stylelint = require('gulp-stylelint');
      return gulp.src(paths.css)
        .pipe(stylelint({
          syntax: 'less',
          failAfterError: false,
          configFile: stylelintrc,
          reporters: [{
            // TODO: The Stylelint "verbose" reporter is very comprehensive but maybe not enough
            // swiggy, so we probably should create our own, loosely based on the lesshint one
            formatter: 'verbose', console: true
          }, {
            formatter: (results) => {
              const errors = results.filter(res => res.errored && !res.ignored);
              if (errors.length) {
                const output = `You've got ${errors.length.toString().magenta}${errors.length > 1 ? ' errors' : ' error'}`;
                swig.log.error('lint-css', `${output}. Please do some cleanup before proceeding.`);
                process.exit(1);
              } else {
                swig.log.info('', `${results.length} files lint-free.\n`);
              }
              return '';
            },
            console: true
          }]
        }));
    }

    // Let's inform the user that the preferable way of linting CSS is by using the Stylelint
    // engine, with a nice deprecation alert.
    ['   --- WARNING ---',
      '   You are using the less than optimal Lesshint engine to lint your stylesheets.',
      '   Consider using Stylelint instead, adding the flag `--use-stylelint` to the command.',
      '   Lesshint is to be considered deprecated and will be removed in the next major release of Swig (3.0.0)'
    ].forEach(str => swig.log(str.yellow));

    const buffer = require('gulp-buffer');
    const lesshint = require('gulp-lesshint');
    const reporter = require('./lib/reporters/lesshint-reporter')(swig);

    return gulp.src(paths.css)
      .pipe(buffer())
      .pipe(lesshint({
        configPath: path.join(__dirname, '.lesshintrc')
      }))
      .on('error', () => {})
      .pipe(reporter);
  });

  gulp.task('lint-handlebars', ['lint-setup'], () => {
    swig.log.task('Linting Handlebars Templates');

    const handlebars = require('gulp-handlebars');
    const reporter = require('./lib/reporters/handlebars-reporter')(swig);

    return gulp.src(paths.templates)
      .pipe(handlebars())
      .on('error', reporter.fail)
      .pipe(reporter);
  });

  gulp.task('lint', (done) => {
    swig.seq(
      'lint-package-version',
      'lint-old-require',
      'dependencies', // from swig-deps
      'lint-script',
      'lint-css',
      'lint-handlebars',
      done
    );
  });
};
