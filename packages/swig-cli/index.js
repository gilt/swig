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

require('colors');

const gulp = require('gulp');

const loadedPlugins = [];

const _ = require('underscore');
const path = require('path');
const os = require('os');
const fs = require('fs');
const argv = require('yargs').argv;
const thisPkg = require('./package.json');
const semverDiff = require('semver-diff');
const strip = require('strip-ansi');
const repeating = require('repeating');

const taskName = argv._.length > 0 ? argv._[0] : 'default';
const swig = {
  pkg: {},
  gulp: gulp,
  argv: argv,
  project: {},
  env: process.env.GILT_ENV || 'development',
  target: {},
  tasks: {},
  watch: {
    enabled: (!!argv.watch || !!argv.watchScripts),
    watchers: []
  },
  get browserslist() {
    const appPkg = swig.pkg;
    // A default list of browser that should be supported in the front end app.
    // This can be overridden locally in the target App by adding a `"browserslist"` field in its own `package.json`
    const defaultBrowserslist = thisPkg.browserslist;

    return appPkg.browserslist || defaultBrowserslist;
  }
};

function load(moduleName) {
  // Avoiding loading the same plugin more than once
  if (loadedPlugins.find(m => m === path.basename(moduleName))) return;

  swig.log.verbose(`Loading: ${path.basename(moduleName)}`);

  try {
    require(moduleName)(gulp, swig);
  } catch (e) {
    // It most likely happened that the user is using swig via an `npm link`d version of the
    // module. In that case the require resolve paths are relative to the linked module folder
    // instead of the target app.
    // Let's attempt to require the module via the module.parent.require function and see what
    // happens.
    if (module.parent) {
      module.parent.require(moduleName)(gulp, swig);
    } else {
      swig.log.error(
        `Error occurred while trying to load module ${moduleName}. \n   ${e}`);
    }
  }

  loadedPlugins.push(path.basename(moduleName));
}

// This loads swig plugins listed as dependencies in the local package.json
// as well as those listed as devDependencies in the target app/module package.json
function loadPlugins(deps) {
  let pluginsList = deps;
  if (!Array.isArray(pluginsList)) {
    if (typeof pluginsList !== 'object') {
      return;
    }
    pluginsList = Object.keys(pluginsList);
  }
  pluginsList.filter(moduleName => /@gilt-tech\/swig-(?!util)/.test(moduleName))
    .forEach(load);
}

function setupPaths() {
  const swigPath = path.join(process.env.HOME, '.swig');

  if (!fs.existsSync(swigPath)) {
    fs.mkdirSync(swigPath);
  }

  swig.home = swigPath;
  swig.cwd = process.cwd();
  swig.temp = path.join(os.tmpdir(), 'swig');
}

function findSwigRc() {
  const rcPath = path.join(process.env.HOME, '/.swigrc');

  if (!fs.existsSync(rcPath)) {
    swig.log.error('swig', `.swigrc not found at: ${'~/.swigrc'.grey}. Please grab a copy from ${'/web/tools/config/user.\n'.grey}`);
    swig.log('.swigrc is required because it contains internal information that swig needs.');
    process.exit(1);
  } else {
    swig.rc = JSON.parse(fs.readFileSync(rcPath));
  }
}

function findTarget() {
  const repo = swig.argv.repo || '';
  let target;

  if (swig.argv.m) {
    swig.argv.module = swig.argv.m;
  }

  if (swig.argv.module) {
    target = path.join('src', swig.argv.module.replace(/\./g, '/'));

    if (repo) {
      target = path.join('/web/', repo, target);
    } else {
      target = path.join(swig.cwd, target);
    }

    if (!fs.existsSync(target)) {
      swig.log();
      swig.log.error('The module specified doesn\'t exist in this repository.');
      swig.log.verbose(target);
      process.exit(1);
    }

    swig.project.type = 'module';
  } else {
    target = repo ? path.join('/web/', repo) : swig.cwd;

    swig.project.type = 'webapp';
  }

  const packagePath = path.join(target, 'package.json');

  if (fs.existsSync(packagePath)) {
    swig.pkg = require(packagePath);
  }

  if (_.isEmpty(swig.pkg)) {
    swig.log(`.  ${'warning!    '.yellow} package.json not found at: ${packagePath.grey}`);
  }

  swig.target = {
    path: target,
    name: swig.argv.module || (swig.pkg && swig.pkg.name) || path.basename(target),
    repo: swig.argv.repo || path.basename(swig.cwd)
  };
}

// allows a task to tell swig about itself
function tell(name, taskInfo) {
  if (swig.tasks[name]) {
    console.log(`Task '${name}' has been overridden by a local installation`.yellow);
  }

  swig.tasks[name] = _.extend({
    description: '<unknown>',
    flags: {},
  }, taskInfo);
}

function checkLocalVersion() {
  let line1 = `Local update available: ${process.env.SWIG_VERSION}${(` (current: ${thisPkg.version})`).gray}`;
  let line2 = `Run ${'npm update @gilt-tech/swig'.blue} to update`;
  const line1Len = strip(line1).length;
  const line2Len = strip(line2).length;
  const maxLen = Math.max(line1Len, line2Len);
  const top = repeating(maxLen + 4, '─');

  if (!semverDiff(thisPkg.version, process.env.SWIG_VERSION)) {
    return;
  }

  if (maxLen > line1Len) {
    line1 += repeating(maxLen - line1Len, ' ');
  } else if (maxLen > line2Len) {
    line2 += repeating(maxLen - line2Len, ' ');
  }

  swig.log(`┌${top}┐`);
  swig.log('│  '.yellow + line1 + '  │'.yellow);
  swig.log('│  '.yellow + line2 + '  │'.yellow);
  swig.log(`└${top}┘`);

  swig.log('·');
}

console.log(`  ·  ${'swig (local)'.red} v${thisPkg.version}\n  ·`);

// NOTE: This loads and installs the swig.log
swig.util = require('@gilt-tech/swig-util')(swig, gulp);

swig.tell = tell;
swig.loadPlugins = loadPlugins;

findSwigRc();
checkLocalVersion();
setupPaths();
findTarget();

const targetName = swig.target.name;

swig.log(`·  ${'target:      '.blue}${targetName ? targetName.grey : 'NO TARGET'.yellow}`);
swig.log(`·  ${'target-path: '.blue}${swig.target.path.grey}\n`);

// create swigs's temporary directory;
if (!fs.existsSync(swig.temp)) {
  fs.mkdirSync(swig.temp);
}

// Loading swig-cli essential swig plugins
loadPlugins(thisPkg.dependencies);

// Loading target app specified plugins
let devDeps = Object.assign({}, swig.pkg.devDependencies || {});
let deps = Object.assign({}, swig.pkg.dependencies || {});
if (swig.argv.module) {
  const parentPkg = require(`${process.cwd()}/package.json`);
  devDeps = Object.assign({}, devDeps, parentPkg.devDependencies);
  deps = Object.assign({}, deps, parentPkg.dependencies);
}

const targetAppCwd = process.cwd();
const targetAppDeps = Object.keys(devDeps)
    .concat(Object.keys(deps))
    .map(m => `${targetAppCwd}/node_modules/${m}`);
loadPlugins(targetAppDeps);

// Run the required task
try {
  gulp.start(taskName);
} catch (e) {
  if (e.missingTask) {
    // most likely the user tried to run an non existent plugin, let's tell him
    swig.log.error(`The task you tried to run does not exist or is not installed: ${e.missingTask.magenta}`);
    swig.log.error(`Try to run: ${`npm install --save @gilt-tech/swig-${e.missingTask}`.yellow}\n`);
    // let's show the user the available tasks
    gulp.start('default');
  } else {
    // well sounds like a real trouble, let's just show the error and run...
    swig.log.error(`An error occurred: ${e}`);
    process.exit(1);
  }
}
