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

module.exports = function (swig) {

  var _ = require('underscore'),
    hooker = require('hooker'),
    symbols = require('log-symbols'),
    readline = require('readline'),
    sprintf = require('sprintf-js').sprintf,
    strip = require('strip-ansi'),
    thunkify = require('thunkify'),
    Table = require('cli-table'),

    linePrefix = '  ',
    lastLine = '',
    lastLineLength = 0;

  require('colors');

  symbols.connector = ': ';
  symbols.start = '▸';
  symbols.info = strip(symbols.info).cyan;
  symbols.success = '✓'.green;
  symbols.download = '↓'.grey;

  if (swig.env === 'production' || swig.argv.pretty === false) {
    symbols.info =    '[ i ]';
    symbols.warning = '[ w ]';
    symbols.error =   '[ x ]';
    symbols.success = '[ o ]'
    symbols.connector = ': ';
    symbols.start = '>'
  }

  if (swig.env === 'development' && !swig.argv.poolparty) {
    var oldLog = console.log,
      oldWrite = process.stdout.write,
      suppress = false;

    // since this commit (https://github.com/gulpjs/gulp-util/commit/6f6e7c2947ccb59d71d3a680e3a76683289a0548)
    // gulp uses stdout for the time, and console.log for the rest.
    // the reason wasn't documented on the commit and it seems silly.
    process.stdout.write = function () {
      var args = Array.prototype.slice.call(arguments);

      suppress = false;

      if (/^\[\d\d\:\d\d:\d\d\]/.test(strip(args[0]))) {
        suppress = true;
      }
      else {
        oldWrite.apply(process.stdout, args);
      }
    }

    // gulp-util.log always starts each log with [00:00:00]
    // we're suppressing that output if on a dev machine.
    console.log = function () {
      var args = Array.prototype.slice.call(arguments);

      if (suppress) {

        // if gulp is reporting an error, let that through.
        _.each(args, function (arg) {
          if (arg && (!_.isString(arg) ||
              arg.toLowerCase().indexOf('error') > -1) ||
              /Task \'(.+)\' is not in your gulpfile/.test(arg)) {
            suppress = false;
          }
        });

        if (suppress) {
          suppress = false;
          return;
        }
      }

      oldLog.apply(console, args);
    }
  }

  function puts (what) {

    what = what || '';

    if (_.isObject(what)) {
      console.log(what);
      return;
    }

    var newline = '\n',
      raw = strip(what),
      trailing = (raw.indexOf(newline) === raw.length - 1),
      lastIndex,
      lines;

    if (what.length === 0) {
      trailing = false;
    }

    // remove any trailing newlines. they suck.
    if (trailing) {
      lastIndex = what.lastIndexOf(newline);
      what = what.substr(0, lastIndex) + what.substr(lastIndex + 1);
    }

    lines = what.split(newline);

    if (lines.length > 1) {
      lines = _.each(lines, function (line, index) {
        lines[index] = (index > 0 ? linePrefix : '') + line;
      });

      what = lines.join('\n');
    }

    if (swig.env === 'production' || swig.argv.pretty === false) {
      what = strip(what);
    }

    lastLine = linePrefix + what;
    lastLineLength = strip(lastLine).length;

    what = lastLine  + (trailing ? newline : '');

    if (swig.argv.pretty === 'false') {
      what = strip(what);
    }

    console.log(what);
  }

  puts = _.extend(puts, {

    symbols: symbols,
    padding: linePrefix,
    strip: strip,

    write: function (what) {
      process.stdout.write(what || '');
    },

    verbose: function (what) {
      if (swig.argv.verbose) {
        puts(what);
      }
    },

    info: function (prefix, what) {
      puts.status(prefix, what, strip(symbols.info).cyan, 'cyan');
    },

    warn: function (prefix, what) {
      puts.status(prefix, what, symbols.warning, 'yellow');
    },

    error: function (prefix, what) {
      puts.status(prefix, what, symbols.error, 'red');
    },

    success: function (prefix, what) {
      puts.status(prefix, what, symbols.success, 'green');
    },

    status: function (prefix, what, symbol, color) {
      what = what || '';
      prefix = prefix || '';
      symbol = symbol || '';

      if (prefix) {
        prefix = (linePrefix + prefix)[color] + (what ? symbols.connector.white : '');
      }

      if (!prefix && what) {
        prefix = linePrefix;
      }

      puts(symbol + prefix + what);
    },

    table: function (rows, options) {

      var table = new Table(_.extend({
        chars: {
          'top': '' , 'top-mid': '' , 'top-left': '' , 'top-right': '',
          'bottom': '' , 'bottom-mid': '' , 'bottom-left': '' ,
          'bottom-right': '', 'left': '' , 'left-mid': '' , 'mid': '' ,
          'mid-mid': '', 'right': '' , 'right-mid': '' , 'middle': ''
        },
        style: { 'padding-left': 1, 'padding-right': 1 }
      }, options));

      rows.forEach(function (row) {
        table.push(row);
      });

      // example usage:
      // table.push(
      //   ['foo', 'bar', 'baz'],
      //   ['frobnicate', 'bar', 'quuz']
      // );

      console.log(table.toString());
    },

    task: function (name) {
      puts(symbols.start.white + linePrefix + name.cyan + ':');
    },

    padLeft: function (what, howMany) {
      return sprintf('%' + (howMany * linePrefix.length) + 's%s', '', what);
    },

    padRight: function (what, howMany) {
      return sprintf('%s%' + (howMany * linePrefix.length) + 's', what, '');
    },

    prompt: thunkify(function prompt (prompt, callback) {
      var iface = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        }),
        result;

      iface.question(prompt + ' ', function (answer) {
        iface.close();
        callback(null, answer);
      });
    }),

    confirm: function* confirm (question) {
      var answer = yield swig.log.prompt(question) || 'n',
        result;

      answer = answer.toLowerCase();
      result = answer.substring(0, 1) === 'y';

      return result;
    }

  });

  return puts;
};
