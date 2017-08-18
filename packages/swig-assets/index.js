

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

module.exports = function (gulp, swig) {
  const _ = require('underscore');
  const co = require('co');
  const fs = require('fs');
  const globby = require('globby');
  const mime = require('mime');
  const path = require('path');
  const s3 = require('s3');
  const thunkify = require('thunkify');
  const waterfall = require('async-waterfall');
  let git;

  swig.tell('assets-deploy', {
    description: 'Deploys Gilt front-end assets.',
    flags: {
      '--force': 'Force the deploy, by skipping the Assets Version Check'
    }
  });

  // Loading swig dependencies
  swig.loadPlugins(require('./package.json').dependencies);

  gulp.task('assets-setup', (done) => {
    swig.log.task('Preparing to Deploy Assets');

    if (!swig.rc || !swig.rc.s3) {
      swig.log();
      swig.log.error('.swigrc', `~/.swigrc is missing the s3 property. You need that value to continue.${
        '\n\n            You can grab an updated .swigrc file from /web/tools/config/user/.swigrc or add the value manually.'.bold}`);
      process.exit(1);
    }

    const errs = [];
    let err = false;

    // make sure our config has all the values we'll need
    _.each(['bucket', 'accessKey', 'assetsDir', 'secretKey'], (property) => {
      if (!swig.rc.s3[property]) {
        err = true;
        errs.push(`~/.swigrc is missing the s3.${property} property. You need that value to continue.`);
      }
    });

    if (err) {
      swig.log();
      swig.log.error('.swigrc', errs.join('\n            '));
      swig.log('\n            You can grab an updated .swigrc file from /web/tools/config/user/.swigrc or add the missing value(s) manually.'.bold);
      process.exit(1);
    }

    done();
  });

  gulp.task('assets-check-version', ['assets-setup'], co.wrap(function* () {
    const tagName = `${swig.pkg.name}-${swig.pkg.version}-assets`;

    git = require('simple-git')(swig.target.path);
    git.exec = thunkify(git._run);

    if (swig.argv.force) {
      swig.log('');
      swig.log.task('Skipping the Assets Version Check');
      swig.log.warn('', 'The --force is strong with this one.\n');

      const question = 'Are you sure you want to force this deploy? (y/n)'.white;
      const answer = yield swig.log.prompt(swig.log.padLeft(question, 1));

      if (!answer || (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes')) {
        swig.log();
        swig.log('(╯°□°）╯︵ ┻━┻)  Allllrighty then.');
        process.exit(1);
      } else {
        swig.log();
        swig.log('BRING IT ON, CUPCAKE!  ᕦ(ò_ó*)ᕤ\n');
      }

      return;
    }

    swig.log('');
    swig.log.task('Checking Assets Version');
    swig.log.info('', `Looking for Git tag: ${tagName}`);

    let result;

    // Make sure all our tags are up to date first
    yield git.exec('fetch --tags');
    // get the list of tags
    result = yield git.exec('tag');
    result = result.split('\n');

    if (_.contains(result, tagName)) {
      swig.log();
      swig.log.error('swig-assets',
        `It looks like you've already deployed the assets for this version.\n   The tag: ${tagName}, already exists.\n` +
        `   If you believe that was in error, you can delete the tag and try again, or use the --force flag\n${
        '   but tread carefully!'.bold}`
      );
      process.exit(1);
    }

    swig.log.info('', 'Tag is new. We\'re good to go.');
  }));

  gulp.task('assets-s3', (done) => {
    // https://s3.amazonaws.com/gilt-assets/a/js/web-x-domain/0.0.13/main.full.min.js
    // is the same as
    // https://cdn5.giltcdn.com/a/js/web-x-domain/0.0.13/main.full.min.js
    // where 'gilt-assets' is the bucket name

    swig.log('');
    swig.log.task('Deploying Assets to S3');
    swig.log.info('', 'Assets @ https://s3.amazonaws.com/gilt-assets/');

    const basePath = path.join(swig.target.path, '/public/{{dir}}', swig.target.name);
    const directories = ['css', 'img', 'js', 'templates', 'vue-assets'];
    const client = s3.createClient({
      s3Options: {
        accessKeyId: swig.rc.s3.accessKey,
        secretAccessKey: swig.rc.s3.secretKey
      }
    });
    const tasks = [];

    _.each(directories, (dir) => {
      tasks.push((callback) => {
        const params = {
          localDir: basePath.replace('{{dir}}', dir),
          deleteRemoved: true,
          s3Params: {
            Bucket: swig.rc.s3.bucket,
          // eg. /a/js/web-checkout/0.1.1/
            Prefix: path.join(swig.rc.s3.assetsDir, dir, swig.target.name, swig.pkg.version)
          },
          getS3Params: function (localFile, stat, cb) {
            let mimeType = mime.lookup(localFile);

          // file is .js or .css AND charset is not already present in mimeType
            if (/\.(?:css|js)$/.test(localFile) && !/charset=/.test(mimeType)) {
              mimeType += '; charset=utf-8';
            }
            cb(null, { ContentType: mimeType });
          }
        };
        const uploader = client.uploadDir(params);
        let lastPercent = '';
        let progressBegan = false;

        swig.log();
        swig.log.task(`Syncing ${params.localDir.grey}`);

        uploader.on('error', (err) => {
          // don't worry about ugly output here.
          swig.log();
          swig.log.error('deploy-s3', err.stack);
        });

        uploader.on('progress', () => {
          if (uploader.progressAmount <= 0) {
            if (!progressBegan) {
              progressBegan = true;
              lastPercent = '0%';
              const preamble = `${swig.log.symbols.info}  Progress ${swig.log.symbols.start}${swig.log.symbols.start} ${lastPercent.white}`;
              swig.log.write(swig.log.padLeft(preamble, 1));
            }
            return;
          }

          const percent = parseInt((uploader.progressAmount / uploader.progressTotal) * 100, 10);
          const backspace = (new Array(lastPercent.length + 1)).join('\b');

          lastPercent = `${percent}%`;

          swig.log.write(backspace + lastPercent.white);
        });

        uploader.on('end', () => {
          const backspace = (new Array(lastPercent.length + 1)).join('\b');

          swig.log.write(backspace + '100%\n'.green);
          swig.log.info('', `Directory Synced to: ${params.s3Params.Prefix.grey}`);

          callback(null);
        });
      });
    });

    waterfall(tasks, () => {
      done();
    });
  });

  /*
   * @note: We only create the git tag if we made it this far.
  */
  gulp.task('assets-tag-version', ['assets-s3'], co.wrap(function* () {
    swig.log('');
    swig.log.task('Tagging Assets Version');

    swig.log.info('', 'Fetching Tags');

    yield git.exec('fetch --tags');

    const tagName = `${swig.pkg.name}-${swig.pkg.version}-assets`;
    let skipPush = false;

    swig.log.info('', `Tagging: ${tagName}`);

    try {
      yield git.exec(`tag ${tagName}`);
    } catch (e) {
      skipPush = true;
      swig.log.error('', e);
    }

    if (!skipPush) {
      swig.log.info('', 'Pushing Tags');
      yield git.exec('push --tags');
    } else {
      swig.log.warn('', 'Skipping Pushing Tags. Disregard this warning if you used --force, and didn\'nt delete the tag prior.');
    }
  }));


  gulp.task('assets-deploy-cleanup', (done) => {
    swig.log.task('Cleaning up generated files');

    const cleanUpDirs = [
      path.join('js', swig.target.name),
      path.join('css', swig.target.name),
      path.join('css', swig.target.name, 'app')
    ];
    const basePath = path.join(swig.target.path, '/public/{{dir}}');
    const globPatterns = [];

    _.each(cleanUpDirs, (dir) => {
      const workDir = basePath.replace('{{dir}}', dir);
      globPatterns.push(`${workDir}/*.min.*`);
      globPatterns.push(`${workDir}/*.src.*`);
      globPatterns.push(`${workDir}/*.map.*`);

      if (dir === 'js') {
        globPatterns.push(`${workDir}/manifest.json`);
        globPatterns.push(`${workDir}/bundles.js`);
      } else if (dir === 'css') {
        globPatterns.push(`${workDir}/*blessed*.css`);
      }
    });

    _.each(globby.sync(globPatterns), (file) => {
      fs.unlinkSync(file);
      swig.log.info('Deleted: '.red + file.grey);
    });

    done();
  });

  /*
   * @note:
   *  Order of Operation:
   *    - assets-check-version
   *    - install
   *    - lint
   *    - spec
   *    - bundle
   *    - merge-css
   *    - assets-setup
   *    - assets-s3
   *    - assets-tag-version
   */
  gulp.task('assets-deploy', function (done) {
    const taskSequence = [
      'assets-check-version',
      'install',
      'spec', // spec lints before running specs
      'transpile-scripts',
      'transpile-node',
      'bundle',
      'minify',
      'assets-tag-version'
    ];

    if (swig.rc.cleanUpAfterAssetsDeploy) {
      taskSequence.push('assets-deploy-cleanup');
    }

    swig.seq.apply(this, taskSequence.concat([done]));
  });
};
