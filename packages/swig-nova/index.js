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
  const inquirer = require('inquirer');
  const _ = require('underscore');
  const argv = require('yargs').argv;
  const AWS = require('aws-sdk');
  const execSync = require('child_process').execSync;
  const co = require('co');
  const fs = require('fs');
  const semverDiff = require('semver-diff');
  const YAML = require('yamljs');
  const path = require('path');

  const execSyncOpts = {
    returnOutput: {
      encoding: 'utf8'
    },
    pipeOutput: {
      encoding: 'utf8',
      stdio: 'inherit'
    }
  };

  const argConfig = {
    env: null,
    stack: null,
    newVersion: null,
    version: null,
    forcedRun: false
  };

  const isNotMasterBranch = execSync('git rev-parse --abbrev-ref HEAD',
        execSyncOpts.returnOutput).trim() !== 'master';

  const lastRc = execSync('git tag -l --sort=-v:refname | egrep \'(?:-rc\\d+)$\' | head -n 1', execSyncOpts.returnOutput);

  let isNewBuild;
  const novayml = YAML.load('./nova.yml');
  let novaEnv;
  let deployVersion;

  // Loading swig dependencies
  swig.loadPlugins(require('./package.json').dependencies);

  /**
   * @desc  Output help & instructions to console.
   */
  function outputHelp() {
    console.log('');
    console.log('Usage:');
    console.log('swig nova-deploy [options]');
    console.log('');
    console.log('Options:');
    console.log('  --env            Name of environment in nova.yml to deploy to.');
    console.log('  --stack          Name of stack in nova.yml to deploy to.');
    console.log('  --new-version    Deploy a new version, valid options are (patch|minor|major). Version will ');
    console.log('                   be incremented in package.json accordingly and tagged in git.');
    console.log('  --latest-tag     Get the latest version tag on the current');
    console.log('  --version        Specify new version manually. Value should be N.N.N and newer that latest');
    console.log('  --force, -f      Skip confirmation phases (useful for CI environments)');
    console.log('                   deployed version.');
    console.log('');
    process.exit(0);
  }

  function getLatestVersionTag() {
    // eslint-disable-next-line
    return execSync('git tag -l --sort=-v:refname | egrep \'v(?:[0-9]\.?)+[0-9]$\' | head -n 1', execSyncOpts.returnOutput);
  }

  function getLatestVersionParsed() {
    return getLatestVersionTag().match(/v((\d+)\.(\d+)\.(\d+))/);
  }

  function getRCSuffix(version) {
    let suffix = '-rc1';
    if (lastRc && ~lastRc.indexOf(version)) {
      suffix = `-rc${Number(lastRc.replace(/.+?-rc/, '')) + 1}`;
    }
    return suffix;
  }

  gulp.task('nova-check-options', (done) => {
    const checkFilesExist = [
      './Dockerfile',
      './nova.yml'
    ];
    let fileNotFound = false;


    // First thing, let's check if we have the right tools installed
    try {
      execSync('which nova');
    } catch (e) {
      swig.log.error('\'nova\' deploy tool does not appear to be installed. https://github.com/gilt/nova');
      process.exit(1);
    }

    // Then check if all the required files exist

    checkFilesExist.forEach((file) => {
      if (!fs.existsSync(file)) {
        swig.log.error(`Required file ${file} not found.`);
        fileNotFound = true;
      }
    });

    if (fileNotFound) {
      process.exit(1);
    }

   // Check if the git repo is not 'dirty'

    const gitDiffResult = execSync('git diff --shortstat 2> /dev/null | tail -n1', execSyncOpts.returnOutput);
    if (gitDiffResult !== '') {
      swig.log.error('Git repo is dirty, please commit all changes and try again');
      process.exit(1);
    }

    // Check arguments validity

    if (argv.latestTag) {
      swig.log.info(`Latest version tag is: ${getLatestVersionTag()}`);
      process.exit(0);
    }

    if (argv.env) {
      novaEnv = novayml.environments.find(
          e => e.name.toLowerCase() === argv.env.toLowerCase());
      if (!novaEnv) {
        swig.log.error(`Environment '${argv.env}' not found in your nova.yml.`);
        swig.log.info('Maybe a typo. Do not worry, we will ask you which ' +
            'environment you want to deploy to later.');
      } else {
        argConfig.env = novaEnv.name;
      }
    }

    if (argv.stack) {
      if (!novayml.environments.find(e => e.stacks.find(
            s => s.stack_name.toLowerCase() === argv.stack.toLowerCase()))) {
        swig.log.error(`Stack '${argv.stack}' not found in your nova.yml.`);
        swig.log.info('Maybe a typo. Do not worry, we will ask you which ' +
            'stack you want to deploy later.');
      } else {
        argConfig.stack = argv.stack;
      }
    }

    if (argv.version && argv.newVersion) {
      swig.log.error('--version and --new-version options can not be specified together.');
      outputHelp();
    }

    if (argv.newVersion) {
      if (!/^(?:patch|minor|major)$/.test(argv.newVersion)) {
        swig.log.error('Invalid value specified for --new-version option.');
        outputHelp(); // exits
      }
      argConfig.newVersion = argv.newVersion;
    }

    if (argv.version) {
      if (!/^\d+\.\d+\.\d+$/.test(argv.version)) {
        swig.log.error('Invalid value specified for --version option.');
        outputHelp(); // exits
      }
      argConfig.version = argv.version;
    }

    if (argv.force || argv.f) {
      argConfig.forcedRun = true;
    }

    done();
  });

  gulp.task('nova-inquisitor', co.wrap(function* () {
    swig.log('');
    const prompt = inquirer.createPromptModule();
    const environments = novayml.environments.map(e => e.name);
    const v = getLatestVersionTag().replace('v', '').split('.').map(n => +n);

    if (v.length < 3) {
      v[0] = 0;
      v[1] = 0;
      v[2] = 0;
    }

    let answer;
    let env;

    if (isNotMasterBranch) {
      swig.log('');
      answer = yield prompt({
        type: 'confirm',
        name: 'confirmed',
        message: 'WARNING: You are about to release from a branch different than "master". Are you sure you want to continue?',
        default: false
      });
      if (!answer.confirmed) {
        swig.log.info('Aborted!'.red);
        process.exit(1);
      }
      swig.log.info('Since you are releasing from a branch that is not "master"');
      swig.log.info('the version you will choose will be suffixed with "-rc",');
      swig.log.info('and you will only be allowed to release on staging.');
      swig.log('');
      if (!novayml.environments.find(e => e.stacks.find(
            s => s.stack_name.toLowerCase() === 'staging'))) {
        swig.log.info('It seems like you do not have a staging stack set in your nova.yml');
        swig.log.info('Aborting the operation.'.red);
        process.exit(1);
      } else {
        argConfig.stack = 'staging';
      }
    }

    if (!argConfig.env) {
      if (environments.length > 1) {
        answer = yield prompt({
          type: 'list',
          name: 'env',
          message: 'Choose the AWS environment you need to deploy to:',
          choices: environments
        });
        env = answer.env;
      } else {
        if (!argConfig.forcedRun) {
          answer = yield prompt({
            type: 'confirm',
            name: 'envConfirmed',
            message: `You will deploy to the AWS '${environments[0]}' environment. Correct?`,
            default: true
          });
          if (!answer.envConfirmed) {
            swig.log.info('Aborted!'.red);
            process.exit(1);
          }
        }
        env = environments[0];
      }
      argConfig.env = env;
      novaEnv = novayml.environments.find(e => e.name === env);
    }

    const stacks = novaEnv.stacks.map(s => s.stack_name);
    let stack;

    if (argConfig.stack) {
      const stackConf = novaEnv.stacks.find(
          s => s.stack_name.toLowerCase() === argConfig.stack.toLowerCase());
      if (!stackConf) {
        swig.log.error(`Stack '${argConfig.stack}' for environment ${env} not found in your nova.yml.`);
        if (isNotMasterBranch) {
          swig.log.info('Aborted!'.red);
          process.exit(1);
        }
      } else {
        argConfig.stack = stackConf.stack_name;
        stack = stackConf.stack_name;
      }
    }

    if (!argConfig.stack || !stack) {
      if (stacks.length > 1) {
        answer = yield prompt({
          type: 'list',
          name: 'stack',
          message: 'Choose the AWS stack you need to deploy to:',
          choices: stacks
        });
        stack = answer.stack;
      } else {
        if (!argConfig.forcedRun) {
          answer = yield prompt({
            type: 'confirm',
            name: 'stackConfirmed',
            message: `You will deploy to the AWS '${stacks[0]}' stack. Correct?`,
            default: true
          });
          if (!answer.stackConfirmed) {
            swig.log.info('Aborted!'.red);
            process.exit(1);
          }
        }
        stack = stacks[0];
      }
      argConfig.stack = stack;
    }

    if (!argConfig.version && !argConfig.newVersion) {
      const currentVersion = `(current: ${v.join('.')})`.grey;
      answer = yield prompt({
        type: 'list',
        name: 'version',
        message: `What version bump do you want to perform? ${currentVersion}`,
        choices: [
          { name: `major ${`(${v[0] + 1}.0.0)`.grey}`,
            value: 'major',
            short: 'major' },
          { name: `minor ${`(${v[0]}.${v[1] + 1}.0)`.grey}`,
            value: 'minor',
            short: 'minor' },
          { name: `patch ${`(${v[0]}.${v[1]}.${v[2] + 1})`.grey}`,
            value: 'patch',
            short: 'patch' },
          { name: 'Manually type new version...', value: 'manual' }
        ]
      });

      if (answer.version === 'manual') {
        answer = yield prompt({
          type: 'input',
          name: 'version',
          message: `What will be the new version? ${currentVersion}`,
          validate: version => /^\d+\.\d+\.\d+$/.test(version)
        });
        argConfig.version = answer.version;
        if (isNotMasterBranch) {
          const suffix = getRCSuffix(argConfig.version);
          argConfig.version = `${argConfig.version}${suffix}`;
        }
      } else {
        argConfig.newVersion = answer.version;
      }
    }

    swig.log('');
    swig.log.info('', 'Deploying with the following configuration:');
    swig.log.status('', ' Environment: '.cyan + `'${argConfig.env}'`.green);
    swig.log.status('', ' Stack: '.cyan + `'${argConfig.stack}'`.green);
    if (argConfig.version) {
      swig.log.status('', ' New Version: '.cyan + `${argConfig.version}`.green);
    } else {
      let newV;
      if (argConfig.newVersion === 'major') {
        newV = `${v[0] + 1}.0.0`;
      }
      if (argConfig.newVersion === 'minor') {
        newV = `${v[0]}.${v[1] + 1}.0`;
      }
      if (argConfig.newVersion === 'patch') {
        newV = `${v[0]}.${v[1]}.${v[2] + 1}`;
      }
      const suffix = isNotMasterBranch ? getRCSuffix(newV) : '';
      swig.log.status('', ' New Version: '.cyan + `${newV}${suffix}`.green);
    }

    if (!argConfig.forcedRun) {
      swig.log('');
      answer = yield prompt({
        type: 'confirm',
        name: 'confirmed',
        message: 'Are you sure you want to proceed?',
        default: true
      });
      if (!answer.confirmed) {
        swig.log.info('Aborted!'.red);
        process.exit(1);
      }
    }
  }));

  gulp.task('pull-latest-tags', () => {
    swig.log.info('Fetching latest tags from git');
    execSync('git fetch --tags', execSyncOpts.pipeOutput);
  });

  gulp.task('nova-check-aws-auth', (done) => {
    swig.log.info(`Using AWS profile: ${novaEnv.aws_profile}`);

    AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: novaEnv.aws_profile });

    const s3Client = new AWS.S3();

    s3Client.listObjects({
      Bucket: novaEnv.deployment_bucket,
      MaxKeys: 1
    }, (err) => {
      if (err) {
        if (err.code === 'ExpiredToken') {
          swig.log.error(`AWS token for profile '${novaEnv.aws_profile}' is expired. Please renew your token and retry.`);
          process.exit(1);
        } else {
          // some error has occurred, but it's not an expired token, so we'll try and proceed.
          done();
        }
      } else {
        swig.log.success('Verified AWS connection and token is good.');
        done();
      }
    });
  });

  gulp.task('nova-new-version', () => {
    if (argConfig.newVersion) {
      let vMatch = getLatestVersionParsed();

      if (vMatch === null) {
        swig.log.error(`Something went wrong parsing the latest git version tag: "${getLatestVersionTag()}"`);
        swig.log.info('Tip: You can specify the new version manually using --version N.N.N as a workaround');
        process.exit(1);
      }

      vMatch = vMatch.slice(2);
      vMatch = vMatch.map(i => parseInt(i, 10));

      if (argConfig.newVersion === 'major') {
        vMatch[0]++;
        vMatch[1] = 0;
        vMatch[2] = 0;
      } else if (argConfig.newVersion === 'minor') {
        vMatch[1]++;
        vMatch[2] = 0;
      } else if (argConfig.newVersion === 'patch') {
        vMatch[2]++;
      }

      const newV = vMatch.join('.');
      const suffix = isNotMasterBranch ? getRCSuffix(newV) : '';
      const newVersion = `${newV}${suffix}`;

      swig.log.info(`New version after [${argConfig.newVersion}] bump: ${newVersion.green}`);

      execSync(`npm --no-git-tag-version version ${newVersion}`);

      swig.pkg.version = newVersion;

      isNewBuild = true;
      deployVersion = newVersion;
    }
  });

  gulp.task('nova-specified-version', () => {
    if (argConfig.version) {
      if (!isNotMasterBranch) {
        const versionMatch = argConfig.version.match(/^((\d+)\.(\d+)\.(\d+))$/);

        if (versionMatch === null) {
          swig.log.error('value passed for version must be in the format N.N.N');
          process.exit(1);
        }

        const latestVersion = getLatestVersionParsed();

        if (latestVersion && semverDiff(latestVersion[1], versionMatch[1]) === null) {
          swig.log.error(`New version can not be less than latest existing version: ${latestVersion[1]}`);
          process.exit(1);
        } else {
          isNewBuild = true;
        }
      } else {
        isNewBuild = true;
      }

      if (isNewBuild) {
        execSync(`npm --no-git-tag-version version ${argConfig.version}`);
        swig.pkg.version = argConfig.version;
      }

      deployVersion = argConfig.version;
    }
  });

  gulp.task('nova-version-cleanup', () => {
    swig.log('');
    if (isNewBuild) {
      let gitCommands;
      if (isNotMasterBranch) {
        swig.log.info('Tagging RC version on git');
        gitCommands = [
          `git tag -a -m "Release Candidate v${deployVersion}" v${deployVersion}`,
          'git push --tags',
          'git checkout package.json'
        ];
      } else {
        swig.log.info('Tagging release version on git');
        gitCommands = [
          'git add package.json',
          `git tag -a -m "v${deployVersion}" v${deployVersion}`,
          `git commit -m "autocommit: v${deployVersion} set in package.json"`,
          'git push --tags',
          'git push || true'      // If we're on a local branch and don't want to abort the script when 'git push' fails, hence the '|| true' at the end
        ];
      }

      execSync(gitCommands.join(';'), execSyncOpts.pipeOutput);
    }
  });

  gulp.task('nova-build-docker', () => {
    swig.log('');
    swig.log.info('Building Docker image');
    const imageAlreadyExists = execSync(`docker images -q ${novayml.service_name}:${deployVersion}`, execSyncOpts.returnOutput);
    const homeNpmrcPath = path.join(process.env.HOME, '.npmrc');
    const localNpmrcPath = path.join('.', '.npmrc');
    const dockerIgnoreTemplate = path.join(__dirname, 'templates', 'dockerignore.template');
    const localDockerIgnorePath = path.join('.', '.dockerignore');

    if (imageAlreadyExists) {
      swig.log.warn(`Docker image with tag [${novayml.service_name}:${deployVersion}] already exists, using this.`);
    } else {
      try {
        // track if .npmrc & .dockerignore exist in the project folder, so as to know whether to
        // clean them up after the docker container is built.
        let localNpmrc = false;
        let localDockerIgnore = false;

        if (fs.existsSync(localDockerIgnorePath)) {
          localDockerIgnore = true;
          swig.log.warn(`Local .dockerignore file being used at ${localDockerIgnorePath}. Remove this to use nova-deploy's default`);
        } else {
          fs.linkSync(dockerIgnoreTemplate, localDockerIgnorePath);
        }

        if (fs.existsSync(localNpmrcPath)) {
          localNpmrc = true;
        } else {
          fs.linkSync(homeNpmrcPath, localNpmrcPath);
        }

        execSync(`docker build -t ${novayml.service_name}:${deployVersion} .`, _.extend({ stdio: 'pipe' }, execSyncOpts.pipeOutput));

        // remove .npmrc if it didn't exist before the script was run.
        if (!localNpmrc) {
          fs.unlinkSync(localNpmrcPath);
        }
        // remove .dockerignore if it didn't exist before the script was run.
        if (!localDockerIgnore) {
          fs.unlinkSync(localDockerIgnorePath);
        }
      } catch (e) {
        swig.log.error(`Docker build failed. ${e.message}`);
        process.exit(1);
      }
    }
  });

  gulp.task('nova-call-deploy', () => {
    swig.log.info('Calling nova...');
    swig.log();
    execSync(`nova deploy ${argConfig.env} ${argConfig.stack} ${deployVersion}`, execSyncOpts.pipeOutput);
  });

  gulp.task('npm-call-build-nova', () => {
    if (swig.pkg.scripts && swig.pkg.scripts['build:nova']) {
      swig.log.info('Found an npm "build:nova" script. Running it now.');
      execSync('npm run build:nova', {
        cwd: process.cwd(),
        stdio: 'inherit'
      });
    }
  });

  gulp.task('nova-deploy', (done) => {
    if (argv.h || argv.help) {    // --help
      outputHelp();
    }

    swig.seq(
      'nova-check-options',
      'nova-inquisitor',
      'nova-check-aws-auth',
      'pull-latest-tags',
      'nova-new-version',
      'nova-specified-version',
      'npm-call-build-nova',
      'assets-deploy',
      'nova-build-docker',
      'nova-version-cleanup',
      'nova-call-deploy',
      done);
  });
};
