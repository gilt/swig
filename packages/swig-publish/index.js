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

const MANUAL_TEST_PUBLISH_DEPRECATED_MSG = `
DEPRECATED: Please use the --beta option if you want to publish a test
version of the module.
Manually change the package.json version is considered bad practice.
`;

module.exports = function (gulp, swig) {
  const _ = require('underscore');
  const fs = require('fs');
  const execa = require('execa');
  const split = require('split2');
  const path = require('path');
  const glob = require('globby');
  const rimraf = require('rimraf');
  const thunkify = require('thunkify');
  const co = require('co');
  const prompt = require('prompt');

  const promptGet = thunkify(prompt.get);
  prompt.message = ' ❯ ';
  prompt.delimiter = '';

  const git = require('simple-git')(swig.target.path);
  git.exec = thunkify(git._run);

  // Loading swig dependencies
  swig.loadPlugins(require('./package.json').dependencies);

  let npmCommand;
  let tagName;
  let targetPath;
  let files;
  let isBetaPublish = false;

  function* gitPublisher() {
    swig.log.info('', 'Fetching Author\'s Email Address');

    const address = yield git.exec('config --get user.email');
    const name = yield git.exec('config --get user.name');

    return { name: name.trim(), email: address.trim() };
  }

  // checks package.json properties 'maintainers' and 'publishedBy' for the
  // current user and adds them if they're not found.
  function* checkPublisher(tempPath) {
    const publisher = yield gitPublisher();
    let publisherFound = false;
    let packagePath;
    let packageJson;

    swig.log();
    swig.log.task('Checking publisher info');

    if (!swig.pkg.maintainers) {
      swig.pkg.maintainers = [];
    }

    _.each(swig.pkg.maintainers, (m) => {
      if (m.email === publisher.email) {
        publisherFound = true;
      }
    });

    if (!publisherFound) {
      swig.log.info('', `Adding ${publisher.email} to "maintainers"`);
      swig.pkg.maintainers.push(publisher);
    }

    if (!swig.pkg.publishedBy || !swig.pkg.publishedBy.email ||
        swig.pkg.publishedBy.email !== publisher.email) {
      swig.log.info('', `Marking package published by ${publisher.email}`);
      publisherFound = false; // re-use this flag
      swig.pkg.publishedBy = publisher;
    }

    if (!publisherFound) {
      packageJson = JSON.stringify(swig.pkg, null, 2);
      packagePath = path.join(swig.target.path, 'package.json');
      fs.writeFileSync(packagePath, packageJson, 'utf-8');
      swig.pkg = require(packagePath);

      swig.log.verbose(`Writing publisher info to: ${
          path.join(tempPath, 'package.json').grey}`);

      swig.fs._fs.copySync(packagePath, path.join(tempPath, 'package.json'));

      // after package.json destined for publish has been safely copied away,
      // lets restore the original from version control
      swig.log.info('', `Restoring ${'package.json'.grey} post publish.`);
      yield git.exec(`checkout -- ${packagePath}`);
    }

    return publisher;
  }

  swig.tell('publish', {
    description:
        'Publishes a Gilt UI Module, providing linting and spec automation.',
    flags: {
      '--module, --m':
          'Specifies the target module to publish within the working directory.',
      '--beta':
          'Instructs the command to publish a beta version of the module'
    }
  });

  gulp.task('publish-verify-clean', co.wrap(function* () {
    swig.log('');
    swig.log.task('Checking Repo State');

    const result = yield git.exec(`status --porcelain ${swig.target.path}`);

    if (result.length) {
      swig.log.error('',
          'All files within a module directory will be published.');

      swig.log.error('', 'As such, we need a clean directory to work with.');
      swig.log.error('', 'Please commit your module changes and try again.');
      process.exit(1);
    } else {
      swig.log.info('', 'Module directory is clean.');
    }
  }));

  gulp.task('publish-verify', ['publish-verify-clean'], (done) => {
    swig.log();
    swig.log.task('Verifying before Publishing');

    tagName = `${swig.target.name}-${swig.pkg.version}`;

    swig.log.info('', 'Verifying Arguments');

    if (swig.argv.m) {
      swig.argv.module = swig.argv.m;
    }

    if (!swig.argv.module) {
      swig.error('publish-verify', 'You must define a module to publish with either the --module or --m flag.');
      process.exit(1);
    }

    targetPath = swig.target.path;

    swig.log.info('', 'Verifying Target');

    if (!fs.existsSync(targetPath)) {
      swig.error('publish-verify',
          `The ${swig.argv.module} module specified doesn't exist here.`);

      process.exit(1);
    }

    swig.log.info('', 'Verifying package.json');

    const pkgPath = path.join(targetPath, '/package.json');

    if (!fs.existsSync(pkgPath)) {
      swig.error('publish-verify',
          'You cannot publish a module without a package.json file.');

      process.exit(1);
    }

    done();
  });

  gulp.task('publish-check-version', ['publish-verify'], co.wrap(function* () {
    swig.log('');
    swig.log.task('Checking Module Version');
    swig.log.info('', `Looking for Git tag: ${tagName}`);

    try {
      const result = (yield git.exec('tag')).split('\n');

      if (_.contains(result, tagName)) {
        swig.log.error('publish-verify',
          `It looks like you've already published this module.\n   The tag: ${
          tagName}, already exists.\n` +
          '   If you believe that was in error, you can delete the tag and try again, but tread carefully!'
        );
        process.exit(1);
      }
    } catch (e) {
      swig.log.error('[publish-tag]', `Failed to tag ${(`${swig.pkg.name}@${
          swig.pkg.version}`).magenta}\n  ${e}`);

      process.exit(1);
    }

    swig.log.success('', 'Tag is new. We\'re good to go.');
  }));

  gulp.task('publish-npm', ['publish-check-version'], co.wrap(function* () {
    const tempPath = path.join(swig.temp, '/publish/', swig.target.name);
    let tagFlag = '';
    let contents;

    if (fs.existsSync(tempPath)) {
      rimraf.sync(path.normalize(tempPath));
    }

    swig.fs.mkdir(tempPath);
    swig.fs.copyAll(targetPath, tempPath);
    swig.fs._fs.copySync(path.join(__dirname, 'npmignore.dotfile'),
        path.join(tempPath, '.npmignore'));

    // replace $$PACKAGE_VERSION$$ with the actual version from package.json
    files = glob.sync(path.join(tempPath, '/**/*.js'));

    swig.log();
    swig.log.task('Replacing $$PACKAGE_VERSION$$');

    _.each(files, (file) => {
      swig.log.info('', file.replace(tempPath, '').grey);

      contents = fs.readFileSync(file, 'utf-8');
      contents = contents.replace(/\$\$PACKAGE_VERSION\$\$/g, swig.pkg.version);

      fs.writeFileSync(file, contents, 'utf-8');
    });

    // remove extended attributes
    files = glob.sync(path.join(tempPath, '/**/*'));

    swig.log();
    swig.log.task('Removing extended attributes');

    _.each(files, co.wrap(function* (file) {
      swig.log.info('', file.replace(tempPath, '').grey);
      yield execa.shell(`xattr -c ${file}`);
    }));

    yield checkPublisher(tempPath);

    // If --beta is specified, then create e -beta.X version and publish with
    // --tag beta
    if (swig.argv.beta) {
      isBetaPublish = true;

      // Fetch existing beta tag, if any
      const npmInfo = yield execa.shell(`npm info ${swig.pkg.name} --json`, {
        preferLocal: false
      });
      let betaVer = JSON.parse(npmInfo.stdout)['dist-tags'].beta;

      // Check if we have to increment the beta version or release a totally new
      // one
      if (betaVer && ~betaVer.indexOf(swig.pkg.version)) {
        // There is already a beta for the current version number.
        // Let's ask the user if we should increment the beta number or abort.
        swig.log.warn('', `Warning: A beta package with version ${betaVer} already exists.`.yellow);
        prompt.start();
        const promptRes = yield promptGet([{
          description: 'Do you want to increment the beta number? [y/N]'.white,
          type: 'string',
          pattern: /^y|n$/i,
          message: 'Just type Y for yes or N for no.',
          default: 'n',
          required: true
        }]);

        if (/y|Y/.test(promptRes.question)) {
          const betaN = parseInt(betaVer.split('').pop(), 10);
          betaVer = `${betaVer.slice(0, -1)}${betaN + 1}`;
        } else {
          swig.log.error('', `Publishing of ${swig.pkg.name} beta version ${betaVer} aborted.`.red);
          process.exit(1);
        }
      } else {
        betaVer = `${swig.pkg.version}-beta.1`;
      }

      swig.log.info('', `Publishing new beta version ${betaVer} of ${swig.pkg.name}`);

      // Save the temporary beta version number in the package.json
      fs.writeFileSync(
        path.join(tempPath, 'package.json'),
        JSON.stringify(Object.assign({}, swig.pkg, {
          version: betaVer,
        }), null, 2),
        'utf-8'
      );

      tagFlag = ' --tag beta';
    } else if (swig.pkg.version.indexOf('-') > 0) {
      swig.log(MANUAL_TEST_PUBLISH_DEPRECATED_MSG.yellow);
      // if the version contains a hypen, then assume that we're publishing
      // a test version. this keeps the module from being tagged as `latest`
      // in the registry.
      tagFlag = ' --tag=test'; // leading space is important
    }

    try {
      // run npm against the temp module location, redirect stderr to stdout
      npmCommand = [
        `cd ${tempPath}`,
        `npm publish .${tagFlag} --loglevel=info 2>&1`
      ].join('; ');

      swig.log.info('', `NPM Command:\n  ${
          npmCommand.split('; ').join(';\n  ')}`);

      swig.log.info('', 'Publishing Module');

      const publishProcess = execa.shell(npmCommand, {
        preferLocal: false
      });

      if (swig.argv.verbose) {
        publishProcess.stdout.pipe(split()).on('data', (line) => {
          console.log(line);
        });
      }

      const result = yield publishProcess;

      if (!result.stdout.indexOf('npm info ok')) {
        swig.log.error('', 'Sad Pandas. Publish Failed.');
        swig.log.info('', `Command Output:\n    ${result.stdout}\n    ${result.stderr}`.grey);
      } else {
        swig.log.success('', 'Module published to npm successfully.');
      }
    } catch (e) {
      swig.log();
      swig.log.error('', 'Sad Pandas. Publish Failed:');
      swig.log.error('', e.message || e);
      swig.log.error('', e.stack);
      process.exit(1);
    }
  }));

  gulp.task('publish-tag-version', co.wrap(function* () {
    swig.log('');
    swig.log.task('Tagging Module Version');

    try {
      swig.log.info('', 'Fetching Tags');
      yield git.exec('fetch --tags');

      swig.log.info('', `Tagging: ${tagName}`);
      yield git.exec(`tag ${tagName}`);

      swig.log.info('', 'Pushing Tags');
      yield git.exec('push --tags');
    } catch (e) {
      swig.log.error('[publish-tag-version]', `Failed to tag ${
          (`${swig.pkg.name}@${swig.pkg.version}`).magenta}\n  ${e}`);
      process.exit(1);
    }

    swig.log();
  }));

  gulp.task('publish-tag-and-send-email', (done) => {
    if (isBetaPublish) return;

    swig.seq(
      'publish-tag-version',
      'release-email',
      done
    );
  });

  /*
   * @note:
   *  Order of Operations
   *    - lint
   *    - spec
   *    - publish-verify
   *    - publish-check-version
   *    - publish-npm
   *
   *    and if not a beta version:
   *    - publish-tag-version
   *    - release-email
  */
  gulp.task('publish', (done) => {
    swig.seq(
      'spec',
      'publish-npm',
      'publish-tag-and-send-email',
      done);
  });
};
