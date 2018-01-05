

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
  const _ = require('underscore');
  const path = require('path');
  const fs = require('fs');
  const fsx = require('fs-extra');
  const os = require('os');
  const glob = require('globby');
  const less = require('less');
  const postcss = require('postcss');
  const swigCliPkg = require('../../package.json');
  const autoprefixer = require('autoprefixer');

  const cwd = process.cwd();
  const pkg = require(`${cwd}/package.json`);

  const targetPath = 'css';
  const encoding = 'utf-8';
  const packageName = pkg.name.replace('@gilt-tech/', '');
  const publishPath = cwd;
  const cssPath = path.join(publishPath, targetPath);

  // (tmpdir)/swig/publish/(module.name)/../../install/(module.name)
  // should be using swig-[project name]
  const installPath = path.join(os.tmpdir(), `swig-${packageName}`, '/install', packageName, '/public/css/', packageName);

  const _lessPath = path.join(publishPath, '_less');
  const options = { paths: [installPath], relativeUrls: false };
  const imports = [];

  log();
  log.task('Rendering LESS to CSS');
  log.info('', `Looking for install path: ${installPath.grey}`);

  if (!fs.existsSync(installPath)) {
    log.error('', '`swig pre-publish --less` assumes that `swig install` was run as part of a `swig publish` process.');
    log.error('', 'The temporary directory for `swig install` doesn\'t exist, and this tool cannot continue.');
    process.exit(1);
  }

  options.paths.push(_lessPath);

  if (!fs.existsSync(_lessPath)) {
    fsx.mkdirsSync(_lessPath);
  }

  const cssFiles = glob.sync([path.join(cssPath, '**/*.less')]);

  if (!cssFiles.length) {
    log.info('', `Inspecting: ${path.join(cssPath, '**/*.less').grey}`);
    log.info('', 'No files to render!');
    return;
  }

  // we scan each file for imports, and add those imports to a array
  // we'll reference that array so we're not creating duplicate css
  // and not rendering less files which are solely dependencies of other files.
  cssFiles.forEach((filePath) => {
    const contents = fs.readFileSync(filePath, encoding);
    const matches = contents.match(/@import(.+)/gm);
    let imprt;

    if (matches) {
      matches.forEach((m) => {
        imprt = m.match(/@import\s("|')(.+)("|')/);

        // ["@import 'dialog.less'", "'", "dialog.less", "'"]
        if (imprt && imprt.length === 4) {
          imports.push(imprt[2]);
        }
      });
    }

    // keep the old less file around for reference, debugging
    // but move it to _less/
    log.verbose(`Moving to _less: ${path.basename(filePath).grey}`);
    fs.renameSync(filePath, path.join(_lessPath, path.basename(filePath)));
  });

  const lessFiles = glob.sync([path.join(_lessPath, '**/*.less')]);

  // so we found out from ui-build that it does this to enforce that the
  // mixins in less.helpers override anything found elsewhere. as of 11/13/15
  // less.gilt/utilities.less has mixins with the same name which are older
  // and do less than those in less.helpers. fun stuff.
  log.info('Note', 'Each file is prepended with an @import of less.helpers.');

  const prefixer = postcss(autoprefixer({
    browsers: pkg.browserslist || swigCliPkg.browserslist
  }));

  lessFiles.forEach((filePath) => {
    let contents;
    let output;
    let outputPath;

    if (_.contains(imports, filePath.replace(`${_lessPath}/`, ''))) {
      // this file is imported by another. we want to ignore it to avoid
      // duplicate code and other issues.
      return;
    }

    contents = fs.readFileSync(filePath, encoding);
    contents = `@import 'common/helpers/helpers.less';\n${contents}`;

    log.info('', `Rendering: ${path.basename(filePath).grey}`);

    less.render(contents, options)
      .then(res => prefixer.process(res.css))
      .then((res) => {
        output = res.css;
        outputPath = path.join(path.dirname(filePath), `${path.basename(filePath, '.less')}.css`);
        outputPath = outputPath.replace('/_less/', '/css/');

        log.verbose(`Writing: ${outputPath.grey}`);
        fs.writeFileSync(outputPath, output, encoding);
      },
      (err) => {
        // Convert the keys so PluginError can read them
        const error = err;
        error.lineNumber = error.line;
        error.fileName = error.filename;

        // Add a better error message
        error.message = `${error.message} in file ${error.fileName} line no. ${error.lineNumber}`;

        log();
        log(error);
        log();

        log.error('less.render', error);

        process.exit(1);
      });
  });
};
