// this file is included within each <framework>-runner.html file
(function (window) {

  var specNames = [],
    specFiles = [],
    mockEndpoints = [];

  function isObject (obj) {
    var type = typeof obj;
    return type === 'function' || type === 'object' && !!obj;
  };

  function extend (obj) {
    if (!isObject(obj)) return obj;
    var source, prop;
    for (var i = 1, length = arguments.length; i < length; i++) {
      source = arguments[i];
      for (prop in source) {
        obj[prop] = source[prop];
      }
    }
    return obj;
  };

  /*
   * Overrides _.before which allows us to pass an object to any _.once'd
   * function instructing it to reset to allow us to call it again.
   * eg. cart.init({ __reset: true });
   */
  gilt.require(['vendor.underscore'], function (_) {
    var before = function(times, func) {
      var memo;

      return function() {
        var args = Array.prototype.slice.call(arguments),
        last = args[args.length - 1];

        if (last && last.__reset) {
          times = 2;
        }

        if (--times > 0) {
          memo = func.apply(this, args);
        }
        return memo;
      };
    };
    _.once = _.partial(before, 2);
  });

  window.fixtures = {};
  window.mockEndpoints = mockEndpoints;
  window.targetExperience = 'full';

  window.requireModules = function () {
    throw new Error('requireModules is now obsolete.\n\
      If the file begins with requireModules, please update it to use `gilt.define`.\n\
      If requireModules is used within a `describe`, please update it to use `gilt.require`.');
  };

  // internal.gilt_require has deprecated `requireSpecs`
  window.requireSpecs = function requireSpecs () {
    var args = Array.prototype.slice.call(arguments),
      moduleName = (new Date()).getTime().toString();

    // create a temp name for the module, prepend it to arguments.
    args.unshift(moduleName);

    // keep this name in a list, because we're going to require on it
    // to start the specs
    specNames.push(moduleName);

    gilt.define.apply(this, args);
  };

  gilt = window.gilt || (window.gilt = {});

  var oldGiltRequire = gilt.require,
    callbacks = [];

  gilt.require = function (deps, callback) {
    callbacks.push(0);
    oldGiltRequire.call(this, deps, function () {
      callbacks.pop();
      callback.apply(this, arguments);
    });
  };

  function waitForRequires (callback) {

    var self = this;

    if (callbacks.length === 0) {
      callback.call(null);
    }
    else {
      return setTimeout(function () { waitForRequires(callback); }, 100);
    }
  }

  gilt.specs = {
    addFile: function (file) {
      specFiles.push(file);
    },

    start: function (options) {
      if (options.targetExperience) {
        window.targetExperience = options.targetExperience;
      }

      requirejs.config({
        baseUrl: options.baseUrl,
        deps: specFiles,
        callback: function () {
          gilt.require(specNames, function () {
            waitForRequires(options.callback);
          });

        }
      });

    }

  };

})(window);
