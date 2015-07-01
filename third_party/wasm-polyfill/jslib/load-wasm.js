// This file implements a browser utility function to asychronously fetch,
// decode and compile a given WebAssembly module. The caller passes in the url
// of the .wasm file and the returned promise resolves to a compiled (but
// unlinked) module.

var loadWebAssembly = (function() {
  // *** Environment setup code ***
  var ENVIRONMENT_IS_WEB = typeof window === 'object';
  var ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
  var ENVIRONMENT_IS_NODE = typeof process === 'object' && typeof require === 'function' && !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_WORKER;
  var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

  var Module = {};

  if (ENVIRONMENT_IS_NODE) {
    Module['print'] = function print(x) {
      process['stdout'].write(x + '\n');
    };
    var nodeFS = require('fs');
    var nodePath = require('path');
    Module['read'] = function read(filename, binary) {
      filename = nodePath['normalize'](filename);
      var ret = nodeFS['readFileSync'](filename);
      // The path is absolute if the normalized version is the same as the resolved.
      if (!ret && filename != nodePath['resolve'](filename)) {
        filename = path.join(__dirname, '..', 'src', filename);
        ret = nodeFS['readFileSync'](filename);
      }
      if (ret && !binary) ret = ret.toString();
      return ret;
    };
    Module['readBinary'] = function readBinary(filename) { return Module['read'](filename, true) };
    Module['load'] = function load(f) {
      globalEval(read(f));
    };
  } else if (ENVIRONMENT_IS_SHELL) {
    if (typeof read != 'undefined') {
      Module['read'] = read;
    } else {
      Module['read'] = function read() { throw 'no read() available (jsc?)' };
    }
    Module['readBinary'] = function readBinary(f) {
      if (typeof readbuffer === 'function') {
        return new Uint8Array(readbuffer(f));
      }
      var data = read(f, 'binary');
      assert(typeof data === 'object');
      return data;
    };
  } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    Module['read'] = function read(url) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      return xhr.responseText;
    };
    if (typeof console !== 'undefined') {
      if (!Module['print']) Module['print'] = function print(x) {
        console.log(x);
      };
    }
    if (ENVIRONMENT_IS_WORKER) {
      Module['load'] = importScripts;
    }
  } else {
    // Unreachable because SHELL is dependant on the others
    throw 'Unknown runtime environment. Where are we?';
  }

  function globalEval(x) {
    eval.call(null, x);
  }
  if (!Module['load'] && Module['read']) {
    Module['load'] = function load(f) {
      globalEval(Module['read'](f));
    };
  }
  if (!Module['print']) {
    Module['print'] = function(){};
  }
  // *** Environment setup code ***

  // main

  var globalNameCounter = 0;
  var jobs = {};

  reportWebAssembly = function(callbackName, asm) { // global scope, so the new script tags can find it
    var job = jobs[callbackName];
    if (!job) throw 'bad job';
    delete jobs[callbackName];
    job.resolve(asm);
  };

  var workerURL = 'load-wasm-worker.js';
  var worker = new Worker(workerURL);
  worker.onmessage = function(e) {
    if (typeof e.data !== 'object') {
      throw "load-wasm-worker.js failed with: " + e.data;
      return;
    }
    var callbackName = e.data.callbackName;
    var script = document.createElement('script');
    var url = URL.createObjectURL(e.data.data);
    script.onload = function() {
      URL.revokeObjectURL(url);
    };
    script.onerror = function() { URL.revokeObjectURL(url) }
    script.src = url;
    document.body.appendChild(script);
  }

  return function(packedURL) {
    var job = {
      callbackName: 'onFinishLoadWebAssembly_' + globalNameCounter++,
      then: function(resolve) {
        this.resolve = resolve;
      }
    };
    globalEval(job.callbackName + ' = function(asm) { reportWebAssembly("' + job.callbackName + '", asm) }');
    jobs[job.callbackName] = job;
    worker.postMessage({ url: packedURL, callbackName: job.callbackName });
    return job;
  }
})();

