'use strict';


function Zone(parentZone, data) {
  var zone = (arguments.length) ? Object.create(parentZone) : this;

  zone.parent = parentZone;

  Object.keys(data || {}).forEach(function(property) {

    var _property = property.substr(1);

    // augment the new zone with a hook decorates the parent's hook
    if (property[0] === '$') {
      zone[_property] = data[property](parentZone[_property] || function () {});

      // augment the new zone with a hook that runs after the parent's hook
    } else if (property[0] === '+') {
      if (parentZone[_property]) {
        zone[_property] = function () {
          var result = parentZone[_property].apply(this, arguments);
          data[property].apply(this, arguments);
          return result;
        };
      } else {
        zone[_property] = data[property];
      }

      // augment the new zone with a hook that runs before the parent's hook
    } else if (property[0] === '-') {
      if (parentZone[_property]) {
        zone[_property] = function () {
          data[property].apply(this, arguments);
          return parentZone[_property].apply(this, arguments);
        };
      } else {
        zone[_property] = data[property];
      }

      // set the new zone's hook (replacing the parent zone's)
    } else {
      zone[property] = (typeof data[property] === 'object') ?
        JSON.parse(JSON.stringify(data[property])) :
        data[property];
    }
  });

  zone.$id = ++Zone.nextId;

  return zone;
}


Zone.prototype = {
  constructor: Zone,

  fork: function (locals) {
    this.onZoneCreated();
    return new Zone(this, locals);
  },

  bind: function (fn, skipEnqueue) {
    skipEnqueue || this.enqueueTask(fn);
    var zone = this.fork();
    return function zoneBoundFn() {
      return zone.run(fn, this, arguments);
    };
  },

  bindOnce: function (fn) {
    var boundZone = this;
    return this.bind(function () {
      var result = fn.apply(this, arguments);
      boundZone.dequeueTask(fn);
      return result;
    });
  },

  run: function run (fn, applyTo, applyWith) {
    applyWith = applyWith || [];

    var oldZone = window.zone,
      result;

    window.zone = this;

    try {
      this.beforeTask();
      result = fn.apply(applyTo, applyWith);
    } catch (e) {
      if (zone.onError) {
        zone.onError(e);
      } else {
        throw e;
      }
    } finally {
      this.afterTask();
      window.zone = oldZone;
    }
    return result;
  },

  beforeTask: function () {},
  onZoneCreated: function () {},
  afterTask: function () {},
  enqueueTask: function () {},
  dequeueTask: function () {}
};


Zone.patchSetClearFn = function (obj, fnNames) {
  fnNames.map(function (name) {
    return name[0].toUpperCase() + name.substr(1);
  }).
    forEach(function (name) {
      var setName = 'set' + name;
      var delegate = obj[setName];

      if (delegate) {
        var clearName = 'clear' + name;
        var ids = {};

        var bindArgs = setName === 'setInterval' ? Zone.bindArguments : Zone.bindArgumentsOnce;

        zone[setName] = function (fn) {
          var id;
          arguments[0] = function () {
            delete ids[id];
            return fn.apply(this, arguments);
          };
          var args = bindArgs(arguments);
          id = delegate.apply(obj, args);
          ids[id] = true;
          return id;
        };

        obj[setName] = function () {
          return zone[setName].apply(this, arguments);
        };

        var clearDelegate = obj[clearName];

        zone[clearName] = function (id) {
          if (ids[id]) {
            delete ids[id];
            zone.dequeueTask();
          }
          return clearDelegate.apply(this, arguments);
        };

        obj[clearName] = function () {
          return zone[clearName].apply(this, arguments);
        };
      }
    });
};

Zone.nextId = 1;


Zone.patchSetFn = function (obj, fnNames) {
  fnNames.forEach(function (name) {
    var delegate = obj[name];

    if (delegate) {
      zone[name] = function (fn) {
        arguments[0] = function () {
          return fn.apply(this, arguments);
        };
        var args = Zone.bindArgumentsOnce(arguments);
        return delegate.apply(obj, args);
      };

      obj[name] = function () {
        return zone[name].apply(this, arguments);
      };
    }
  });
};

Zone.patchPrototype = function (obj, fnNames) {
  fnNames.forEach(function (name) {
    var delegate = obj[name];
    if (delegate) {
      obj[name] = function () {
        return delegate.apply(this, Zone.bindArguments(arguments));
      };
    }
  });
};

Zone.bindArguments = function (args) {
  for (var i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === 'function') {
      args[i] = zone.bind(args[i]);
    }
  }
  return args;
};


Zone.bindArgumentsOnce = function (args) {
  for (var i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === 'function') {
      args[i] = zone.bindOnce(args[i]);
    }
  }
  return args;
};

/*
 * patch a fn that returns a promise
 */
Zone.bindPromiseFn = (function() {
  // if the browser natively supports Promises, we can just return a native promise
  if (window.Promise) {
    return function (delegate) {
      return function() {
        var delegatePromise = delegate.apply(this, arguments);
        if (delegatePromise instanceof Promise) {
          return delegatePromise;
        } else {
          return new Promise(function(resolve, reject) {
            delegatePromise.then(resolve, reject);
          });
        }
      };
    };
  } else {
    // if the browser does not have native promises, we have to patch each promise instance
    return function (delegate) {
      return function () {
        return patchThenable(delegate.apply(this, arguments));
      };
    };
  }

  function patchThenable(thenable) {
    var then = thenable.then;
    thenable.then = function () {
      var args = Zone.bindArguments(arguments);
      var nextThenable = then.apply(thenable, args);
      return patchThenable(nextThenable);
    };

    var ocatch = thenable.catch;
    thenable.catch = function () {
      var args = Zone.bindArguments(arguments);
      var nextThenable = ocatch.apply(thenable, args);
      return patchThenable(nextThenable);
    };
    return thenable;
  }
}());


Zone.patchableFn = function (obj, fnNames) {
  fnNames.forEach(function (name) {
    var delegate = obj[name];
    zone[name] = function () {
      return delegate.apply(obj, arguments);
    };

    obj[name] = function () {
      return zone[name].apply(this, arguments);
    };
  });
};

Zone.patchProperty = function (obj, prop) {
  var desc = Object.getOwnPropertyDescriptor(obj, prop) || {
      enumerable: true,
      configurable: true
    };

  // A property descriptor cannot have getter/setter and be writable
  // deleting the writable and value properties avoids this error:
  //
  // TypeError: property descriptors must not specify a value or be writable when a
  // getter or setter has been specified
  delete desc.writable;
  delete desc.value;

  // substr(2) cuz 'onclick' -> 'click', etc
  var eventName = prop.substr(2);
  var _prop = '_' + prop;

  desc.set = function (fn) {
    if (this[_prop]) {
      this.removeEventListener(eventName, this[_prop]);
    }

    if (typeof fn === 'function') {
      this[_prop] = fn;
      this.addEventListener(eventName, fn, false);
    } else {
      this[_prop] = null;
    }
  };

  desc.get = function () {
    return this[_prop];
  };

  Object.defineProperty(obj, prop, desc);
};

Zone.patchProperties = function (obj, properties) {

  (properties || (function () {
    var props = [];
    for (var prop in obj) {
      props.push(prop);
    }
    return props;
  }()).
    filter(function (propertyName) {
      return propertyName.substr(0,2) === 'on';
    })).
    forEach(function (eventName) {
      Zone.patchProperty(obj, eventName);
    });
};

Zone.patchEventTargetMethods = function (obj) {
  var addDelegate = obj.addEventListener;
  obj.addEventListener = function (eventName, fn) {
    arguments[1] = fn._bound = zone.bind(fn);
    return addDelegate.apply(this, arguments);
  };

  var removeDelegate = obj.removeEventListener;
  obj.removeEventListener = function (eventName, fn) {
    arguments[1] = arguments[1]._bound || arguments[1];
    var result = removeDelegate.apply(this, arguments);
    zone.dequeueTask(fn);
    return result;
  };
};

Zone.patch = function patch () {
  Zone.patchSetClearFn(window, [
    'timeout',
    'interval',
    'immediate'
  ]);

  Zone.patchSetFn(window, [
    'requestAnimationFrame',
    'mozRequestAnimationFrame',
    'webkitRequestAnimationFrame'
  ]);

  Zone.patchableFn(window, ['alert', 'prompt']);

  // patched properties depend on addEventListener, so this needs to come first
  if (window.EventTarget) {
    Zone.patchEventTargetMethods(window.EventTarget.prototype);

    // Note: EventTarget is not available in all browsers,
    // if it's not available, we instead patch the APIs in the IDL that inherit from EventTarget
  } else {
    [ 'ApplicationCache',
      'EventSource',
      'FileReader',
      'InputMethodContext',
      'MediaController',
      'MessagePort',
      'Node',
      'Performance',
      'SVGElementInstance',
      'SharedWorker',
      'TextTrack',
      'TextTrackCue',
      'TextTrackList',
      'WebKitNamedFlow',
      'Window',
      'Worker',
      'WorkerGlobalScope',
      'XMLHttpRequestEventTarget',
      'XMLHttpRequestUpload'
    ].
      filter(function (thing) {
        return window[thing];
      }).
      map(function (thing) {
        return window[thing].prototype;
      }).
      forEach(Zone.patchEventTargetMethods);
  }

  if (Zone.canPatchViaPropertyDescriptor()) {
    Zone.patchViaPropertyDescriptor();
  } else {
    Zone.patchViaCapturingAllTheEvents();
    Zone.patchClass('XMLHttpRequest');
    Zone.patchWebSocket();
  }

  // patch promises
  if (window.Promise) {
    Zone.patchPrototype(Promise.prototype, [
      'then',
      'catch'
    ]);
  }
  Zone.patchMutationObserverClass('MutationObserver');
  Zone.patchMutationObserverClass('WebKitMutationObserver');
  Zone.patchDefineProperty();
  Zone.patchRegisterElement();
};

//
Zone.canPatchViaPropertyDescriptor = function () {
  if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'onclick') &&
    typeof Element !== 'undefined') {
    // WebKit https://bugs.webkit.org/show_bug.cgi?id=134364
    // IDL interface attributes are not configurable
    var desc = Object.getOwnPropertyDescriptor(Element.prototype, 'onclick');
    if (desc && !desc.configurable) return false;
  }

  Object.defineProperty(HTMLElement.prototype, 'onclick', {
    get: function () {
      return true;
    }
  });
  var elt = document.createElement('div');
  var result = !!elt.onclick;
  Object.defineProperty(HTMLElement.prototype, 'onclick', {});
  return result;
};

// for browsers that we can patch the descriptor:
// - eventually Chrome once this bug gets resolved
// - Firefox
Zone.patchViaPropertyDescriptor = function () {
  Zone.patchProperties(HTMLElement.prototype, Zone.onEventNames);
  Zone.patchProperties(XMLHttpRequest.prototype);
};

// Whenever any event fires, we check the event target and all parents
// for `onwhatever` properties and replace them with zone-bound functions
// - Chrome (for now)
Zone.patchViaCapturingAllTheEvents = function () {
  Zone.eventNames.forEach(function (property) {
    var onproperty = 'on' + property;
    document.addEventListener(property, function (event) {
      var elt = event.target, bound;
      while (elt) {
        if (elt[onproperty] && !elt[onproperty]._unbound) {
          bound = zone.bind(elt[onproperty]);
          bound._unbound = elt[onproperty];
          elt[onproperty] = bound;
        }
        elt = elt.parentElement;
      }
    }, true);
  });
};

// we have to patch the instance since the proto is non-configurable
Zone.patchWebSocket = function() {
  var WS = window.WebSocket;
  window.WebSocket = function(a, b) {
    var socket = arguments.length > 1 ? new WS(a, b) : new WS(a);
    Zone.patchProperties(socket, ['onclose', 'onerror', 'onmessage', 'onopen']);
    return socket;
  };
}


// wrap some native API on `window`
Zone.patchClass = function (className) {
  var OriginalClass = window[className];
  if (!OriginalClass) {
    return;
  }
  window[className] = function () {
    var a = Zone.bindArguments(arguments);
    switch (a.length) {
      case 0: this._o = new OriginalClass(); break;
      case 1: this._o = new OriginalClass(a[0]); break;
      case 2: this._o = new OriginalClass(a[0], a[1]); break;
      case 3: this._o = new OriginalClass(a[0], a[1], a[2]); break;
      case 4: this._o = new OriginalClass(a[0], a[1], a[2], a[3]); break;
      default: throw new Error('what are you even doing?');
    }
  };

  var instance = new OriginalClass(className.substr(-16) === 'MutationObserver' ? function () {} : undefined);

  var prop;
  for (prop in instance) {
    (function (prop) {
      if (typeof instance[prop] === 'function') {
        window[className].prototype[prop] = function () {
          return this._o[prop].apply(this._o, arguments);
        };
      } else {
        Object.defineProperty(window[className].prototype, prop, {
          set: function (fn) {
            if (typeof fn === 'function') {
              this._o[prop] = zone.bind(fn);
            } else {
              this._o[prop] = fn;
            }
          },
          get: function () {
            return this._o[prop];
          }
        });
      }
    }(prop));
  };
};


// wrap some native API on `window`
Zone.patchMutationObserverClass = function (className) {
  var OriginalClass = window[className];
  if (!OriginalClass) {
    return;
  }
  window[className] = function (fn) {
    this._o = new OriginalClass(zone.bind(fn, true));
  };

  var instance = new OriginalClass(function () {});

  window[className].prototype.disconnect = function () {
    var result = this._o.disconnect.apply(this._o, arguments);
    this._active && zone.dequeueTask();
    this._active = false;
    return result;
  };

  window[className].prototype.observe = function () {
    if (!this._active) {
      zone.enqueueTask();
    }
    this._active = true;
    return this._o.observe.apply(this._o, arguments);
  };

  var prop;
  for (prop in instance) {
    (function (prop) {
      if (typeof window[className].prototype !== undefined) {
        return;
      }
      if (typeof instance[prop] === 'function') {
        window[className].prototype[prop] = function () {
          return this._o[prop].apply(this._o, arguments);
        };
      } else {
        Object.defineProperty(window[className].prototype, prop, {
          set: function (fn) {
            if (typeof fn === 'function') {
              this._o[prop] = zone.bind(fn);
            } else {
              this._o[prop] = fn;
            }
          },
          get: function () {
            return this._o[prop];
          }
        });
      }
    }(prop));
  }
};

// might need similar for object.freeze
// i regret nothing
Zone.patchDefineProperty = function () {
  var _defineProperty = Object.defineProperty;
  var _getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  var _create = Object.create;

  Object.defineProperty = function (obj, prop, desc) {
    if (isUnconfigurable(obj, prop)) {
      throw new TypeError('Cannot assign to read only property \'' + prop + '\' of ' + obj);
    }
    if (prop !== 'prototype') {
      desc = rewriteDescriptor(obj, prop, desc);
    }
    return _defineProperty(obj, prop, desc);
  };

  Object.defineProperties = function (obj, props) {
    Object.keys(props).forEach(function (prop) {
      Object.defineProperty(obj, prop, props[prop]);
    });
    return obj;
  };

  Object.create = function (obj, proto) {
    if (typeof proto === 'object') {
      Object.keys(proto).forEach(function (prop) {
        proto[prop] = rewriteDescriptor(obj, prop, proto[prop]);
      });
    }
    return _create(obj, proto);
  };

  Object.getOwnPropertyDescriptor = function (obj, prop) {
    var desc = _getOwnPropertyDescriptor(obj, prop);
    if (isUnconfigurable(obj, prop)) {
      desc.configurable = false;
    }
    return desc;
  };

  Zone._redefineProperty = function (obj, prop, desc) {
    desc = rewriteDescriptor(obj, prop, desc);
    return _defineProperty(obj, prop, desc);
  };

  function isUnconfigurable (obj, prop) {
    return obj && obj.__unconfigurables && obj.__unconfigurables[prop];
  }

  function rewriteDescriptor (obj, prop, desc) {
    desc.configurable = true;
    if (!desc.configurable) {
      if (!obj.__unconfigurables) {
        _defineProperty(obj, '__unconfigurables', { writable: true, value: {} });
      }
      obj.__unconfigurables[prop] = true;
    }
    return desc;
  }
};

Zone.patchRegisterElement = function () {
  if (!('registerElement' in document)) {
    return;
  }
  var _registerElement = document.registerElement;
  var callbacks = [
    'createdCallback',
    'attachedCallback',
    'detachedCallback',
    'attributeChangedCallback'
  ];
  document.registerElement = function (name, opts) {
    callbacks.forEach(function (callback) {
      if (opts.prototype[callback]) {
        var descriptor = Object.getOwnPropertyDescriptor(opts.prototype, callback);
        if (descriptor.value) {
          descriptor.value = zone.bind(descriptor.value || opts.prototype[callback]);
          Zone._redefineProperty(opts.prototype, callback, descriptor);
        }
      }
    });
    return _registerElement.apply(document, [name, opts]);
  };
}

Zone.eventNames = 'copy cut paste abort blur focus canplay canplaythrough change click contextmenu dblclick drag dragend dragenter dragleave dragover dragstart drop durationchange emptied ended input invalid keydown keypress keyup load loadeddata loadedmetadata loadstart message mousedown mouseenter mouseleave mousemove mouseout mouseover mouseup pause play playing progress ratechange reset scroll seeked seeking select show stalled submit suspend timeupdate volumechange waiting mozfullscreenchange mozfullscreenerror mozpointerlockchange mozpointerlockerror error webglcontextrestored webglcontextlost webglcontextcreationerror'.split(' ');
Zone.onEventNames = Zone.eventNames.map(function (property) {
  return 'on' + property;
});

Zone.init = function init () {
  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = new Zone();
  } else {
    window.zone = new Zone();
  }
  Zone.patch();
};


Zone.init();

/*
 * Wrapped stacktrace
 *
 * We need this because in some implementations, constructing a trace is slow
 * and so we want to defer accessing the trace for as long as possible
 */
Zone.Stacktrace = function (e) {
  this._e = e;
};
Zone.Stacktrace.prototype.get = function () {
  if (zone.stackFramesFilter) {
    return this._e.stack.
      split('\n').
      filter(zone.stackFramesFilter).
      join('\n');
  }
  return this._e.stack;
}

Zone.getStacktrace = function () {
  function getStacktraceWithUncaughtError () {
    return new Zone.Stacktrace(new Error());
  }

  function getStacktraceWithCaughtError () {
    try {
      throw new Error();
    } catch (e) {
      return new Zone.Stacktrace(e);
    }
  }

  // Some implementations of exception handling don't create a stack trace if the exception
  // isn't thrown, however it's faster not to actually throw the exception.
  var stack = getStacktraceWithUncaughtError();
  if (stack && stack._e.stack) {
    Zone.getStacktrace = getStacktraceWithUncaughtError;
    return stack;
  } else {
    Zone.getStacktrace = getStacktraceWithCaughtError;
    return Zone.getStacktrace();
  }
};

Zone.longStackTraceZone = {
  getLongStacktrace: function (exception) {
    var trace = [];
    var zone = this;
    if (exception) {
      if (zone.stackFramesFilter) {
        trace.push(exception.stack.split('\n').
          filter(zone.stackFramesFilter).
          join('\n'));
      } else {
        trace.push(exception.stack);
      }
    }
    var now = Date.now();
    while (zone && zone.constructedAtException) {
      trace.push(
        '--- ' + (Date(zone.constructedAtTime)).toString() +
        ' - ' + (now - zone.constructedAtTime) + 'ms ago',
        zone.constructedAtException.get());
      zone = zone.parent;
    }
    return trace.join('\n');
  },

  stackFramesFilter: function (line) {
    return line.indexOf('zone.js') === -1;
  },

  onError: function (exception) {
    var reporter = this.reporter || console.log.bind(console);
    reporter(exception.toString());
    reporter(this.getLongStacktrace(exception));
  },

  fork: function (locals) {
    var newZone = this._fork(locals);
    newZone.constructedAtException = Zone.getStacktrace();
    newZone.constructedAtTime = Date.now();
    return newZone;
  },

  _fork: zone.fork
};


/*! *****************************************************************************
 Copyright (C) Microsoft. All rights reserved.
 Licensed under the Apache License, Version 2.0 (the "License"); you may not use
 this file except in compliance with the License. You may obtain a copy of the
 License at http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

 See the License for the specific language governing permissions and
 limitations under the License.
 ***************************************************************************** */
"use strict";
var Reflect;
(function (Reflect) {
  // Load global or shim versions of Map, Set, and WeakMap
  var functionPrototype = Object.getPrototypeOf(Function);
  var _Map = typeof Map === "function" ? Map : CreateMapPolyfill();
  var _Set = typeof Set === "function" ? Set : CreateSetPolyfill();
  var _WeakMap = typeof WeakMap === "function" ? WeakMap : CreateWeakMapPolyfill();
  // [[Metadata]] internal slot
  var __Metadata__ = new _WeakMap();
  /**
   * Applies a set of decorators to a property of a target object.
   * @param decorators An array of decorators.
   * @param target The target object.
   * @param targetKey (Optional) The property key to decorate.
   * @param targetDescriptor (Optional) The property descriptor for the target key
   * @remarks Decorators are applied in reverse order.
   * @example
   *
   *     class C {
      *         // property declarations are not part of ES6, though they are valid in TypeScript:
      *         // static staticProperty;
      *         // property;
      *
      *         constructor(p) { }
      *         static staticMethod(p) { }
      *         method(p) { }
      *     }
   *
   *     // constructor
   *     C = Reflect.decorate(decoratorsArray, C);
   *
   *     // property (on constructor)
   *     Reflect.decorate(decoratorsArray, C, "staticProperty");
   *
   *     // property (on prototype)
   *     Reflect.decorate(decoratorsArray, C.prototype, "property");
   *
   *     // method (on constructor)
   *     Object.defineProperty(C, "staticMethod",
   *         Reflect.decorate(decoratorsArray, C, "staticMethod",
   *             Object.getOwnPropertyDescriptor(C, "staticMethod")));
   *
   *     // method (on prototype)
   *     Object.defineProperty(C.prototype, "method",
   *         Reflect.decorate(decoratorsArray, C.prototype, "method",
   *             Object.getOwnPropertyDescriptor(C.prototype, "method")));
   *
   */
  function decorate(decorators, target, targetKey, targetDescriptor) {
    if (!IsUndefined(targetDescriptor)) {
      if (!IsArray(decorators)) {
        throw new TypeError();
      }
      else if (!IsObject(target)) {
        throw new TypeError();
      }
      else if (IsUndefined(targetKey)) {
        throw new TypeError();
      }
      else if (!IsObject(targetDescriptor)) {
        throw new TypeError();
      }
      targetKey = ToPropertyKey(targetKey);
      return DecoratePropertyWithDescriptor(decorators, target, targetKey, targetDescriptor);
    }
    else if (!IsUndefined(targetKey)) {
      if (!IsArray(decorators)) {
        throw new TypeError();
      }
      else if (!IsObject(target)) {
        throw new TypeError();
      }
      targetKey = ToPropertyKey(targetKey);
      return DecoratePropertyWithoutDescriptor(decorators, target, targetKey);
    }
    else {
      if (!IsArray(decorators)) {
        throw new TypeError();
      }
      else if (!IsConstructor(target)) {
        throw new TypeError();
      }
      return DecorateConstructor(decorators, target);
    }
  }
  Reflect.decorate = decorate;
  /**
   * A default metadata decorator factory that can be used on a class, class member, or parameter.
   * @param metadataKey The key for the metadata entry.
   * @param metadataValue The value for the metadata entry.
   * @returns A decorator function.
   * @remarks
   * If `metadataKey` is already defined for the target and target key, the
   * metadataValue for that key will be overwritten.
   * @example
   *
   *     // constructor
   *     @Reflect.metadata(key, value)
   *     class C {
      *     }
   *
   *     // property (on constructor, TypeScript only)
   *     class C {
   *         @Reflect.metadata(key, value)
   *         static staticProperty;
   *     }
   *
   *     // property (on prototype, TypeScript only)
   *     class C {
   *         @Reflect.metadata(key, value)
   *         property;
   *     }
   *
   *     // method (on constructor)
   *     class C {
   *         @Reflect.metadata(key, value)
   *         static staticMethod() { }
   *     }
   *
   *     // method (on prototype)
   *     class C {
   *         @Reflect.metadata(key, value)
   *         method() { }
   *     }
   *
   */
  function metadata(metadataKey, metadataValue) {
    function decorator(target, targetKey) {
      if (!IsUndefined(targetKey)) {
        if (!IsObject(target)) {
          throw new TypeError();
        }
        targetKey = ToPropertyKey(targetKey);
        return OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, targetKey);
      }
      else {
        if (!IsConstructor(target)) {
          throw new TypeError();
        }
        return OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, undefined);
      }
    }
    return decorator;
  }
  Reflect.metadata = metadata;
  /**
   * Define a unique metadata entry on the target.
   * @param metadataKey A key used to store and retrieve metadata.
   * @param metadataValue A value that contains attached metadata.
   * @param target The target object on which to define metadata.
   * @param targetKey (Optional) The property key for the target.
   * @example
   *
   *     class C {
      *         // property declarations are not part of ES6, though they are valid in TypeScript:
      *         // static staticProperty;
      *         // property;
      *
      *         constructor(p) { }
      *         static staticMethod(p) { }
      *         method(p) { }
      *     }
   *
   *     // constructor
   *     Reflect.defineMetadata("custom:annotation", options, C);
   *
   *     // property (on constructor)
   *     Reflect.defineMetadata("custom:annotation", options, C, "staticProperty");
   *
   *     // property (on prototype)
   *     Reflect.defineMetadata("custom:annotation", options, C.prototype, "property");
   *
   *     // method (on constructor)
   *     Reflect.defineMetadata("custom:annotation", options, C, "staticMethod");
   *
   *     // method (on prototype)
   *     Reflect.defineMetadata("custom:annotation", options, C.prototype, "method");
   *
   *     // decorator factory as metadata-producing annotation.
   *     function MyAnnotation(options): Decorator {
      *         return (target, key?) => Reflect.defineMetadata("custom:annotation", options, target, key);
      *     }
   *
   */
  function defineMetadata(metadataKey, metadataValue, target, targetKey) {
    if (!IsObject(target)) {
      throw new TypeError();
    }
    else if (!IsUndefined(targetKey)) {
      targetKey = ToPropertyKey(targetKey);
    }
    return OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, targetKey);
  }
  Reflect.defineMetadata = defineMetadata;
  /**
   * Gets a value indicating whether the target object or its prototype chain has the provided metadata key defined.
   * @param metadataKey A key used to store and retrieve metadata.
   * @param target The target object on which the metadata is defined.
   * @param targetKey (Optional) The property key for the target.
   * @returns `true` if the metadata key was defined on the target object or its prototype chain; otherwise, `false`.
   * @example
   *
   *     class C {
      *         // property declarations are not part of ES6, though they are valid in TypeScript:
      *         // static staticProperty;
      *         // property;
      *
      *         constructor(p) { }
      *         static staticMethod(p) { }
      *         method(p) { }
      *     }
   *
   *     // constructor
   *     result = Reflect.hasMetadata("custom:annotation", C);
   *
   *     // property (on constructor)
   *     result = Reflect.hasMetadata("custom:annotation", C, "staticProperty");
   *
   *     // property (on prototype)
   *     result = Reflect.hasMetadata("custom:annotation", C.prototype, "property");
   *
   *     // method (on constructor)
   *     result = Reflect.hasMetadata("custom:annotation", C, "staticMethod");
   *
   *     // method (on prototype)
   *     result = Reflect.hasMetadata("custom:annotation", C.prototype, "method");
   *
   */
  function hasMetadata(metadataKey, target, targetKey) {
    if (!IsObject(target)) {
      throw new TypeError();
    }
    else if (!IsUndefined(targetKey)) {
      targetKey = ToPropertyKey(targetKey);
    }
    return OrdinaryHasMetadata(metadataKey, target, targetKey);
  }
  Reflect.hasMetadata = hasMetadata;
  /**
   * Gets a value indicating whether the target object has the provided metadata key defined.
   * @param metadataKey A key used to store and retrieve metadata.
   * @param target The target object on which the metadata is defined.
   * @param targetKey (Optional) The property key for the target.
   * @returns `true` if the metadata key was defined on the target object; otherwise, `false`.
   * @example
   *
   *     class C {
      *         // property declarations are not part of ES6, though they are valid in TypeScript:
      *         // static staticProperty;
      *         // property;
      *
      *         constructor(p) { }
      *         static staticMethod(p) { }
      *         method(p) { }
      *     }
   *
   *     // constructor
   *     result = Reflect.hasOwnMetadata("custom:annotation", C);
   *
   *     // property (on constructor)
   *     result = Reflect.hasOwnMetadata("custom:annotation", C, "staticProperty");
   *
   *     // property (on prototype)
   *     result = Reflect.hasOwnMetadata("custom:annotation", C.prototype, "property");
   *
   *     // method (on constructor)
   *     result = Reflect.hasOwnMetadata("custom:annotation", C, "staticMethod");
   *
   *     // method (on prototype)
   *     result = Reflect.hasOwnMetadata("custom:annotation", C.prototype, "method");
   *
   */
  function hasOwnMetadata(metadataKey, target, targetKey) {
    if (!IsObject(target)) {
      throw new TypeError();
    }
    else if (!IsUndefined(targetKey)) {
      targetKey = ToPropertyKey(targetKey);
    }
    return OrdinaryHasOwnMetadata(metadataKey, target, targetKey);
  }
  Reflect.hasOwnMetadata = hasOwnMetadata;
  /**
   * Gets the metadata value for the provided metadata key on the target object or its prototype chain.
   * @param metadataKey A key used to store and retrieve metadata.
   * @param target The target object on which the metadata is defined.
   * @param targetKey (Optional) The property key for the target.
   * @returns The metadata value for the metadata key if found; otherwise, `undefined`.
   * @example
   *
   *     class C {
      *         // property declarations are not part of ES6, though they are valid in TypeScript:
      *         // static staticProperty;
      *         // property;
      *
      *         constructor(p) { }
      *         static staticMethod(p) { }
      *         method(p) { }
      *     }
   *
   *     // constructor
   *     result = Reflect.getMetadata("custom:annotation", C);
   *
   *     // property (on constructor)
   *     result = Reflect.getMetadata("custom:annotation", C, "staticProperty");
   *
   *     // property (on prototype)
   *     result = Reflect.getMetadata("custom:annotation", C.prototype, "property");
   *
   *     // method (on constructor)
   *     result = Reflect.getMetadata("custom:annotation", C, "staticMethod");
   *
   *     // method (on prototype)
   *     result = Reflect.getMetadata("custom:annotation", C.prototype, "method");
   *
   */
  function getMetadata(metadataKey, target, targetKey) {
    if (!IsObject(target)) {
      throw new TypeError();
    }
    else if (!IsUndefined(targetKey)) {
      targetKey = ToPropertyKey(targetKey);
    }
    return OrdinaryGetMetadata(metadataKey, target, targetKey);
  }
  Reflect.getMetadata = getMetadata;
  /**
   * Gets the metadata value for the provided metadata key on the target object.
   * @param metadataKey A key used to store and retrieve metadata.
   * @param target The target object on which the metadata is defined.
   * @param targetKey (Optional) The property key for the target.
   * @returns The metadata value for the metadata key if found; otherwise, `undefined`.
   * @example
   *
   *     class C {
      *         // property declarations are not part of ES6, though they are valid in TypeScript:
      *         // static staticProperty;
      *         // property;
      *
      *         constructor(p) { }
      *         static staticMethod(p) { }
      *         method(p) { }
      *     }
   *
   *     // constructor
   *     result = Reflect.getOwnMetadata("custom:annotation", C);
   *
   *     // property (on constructor)
   *     result = Reflect.getOwnMetadata("custom:annotation", C, "staticProperty");
   *
   *     // property (on prototype)
   *     result = Reflect.getOwnMetadata("custom:annotation", C.prototype, "property");
   *
   *     // method (on constructor)
   *     result = Reflect.getOwnMetadata("custom:annotation", C, "staticMethod");
   *
   *     // method (on prototype)
   *     result = Reflect.getOwnMetadata("custom:annotation", C.prototype, "method");
   *
   */
  function getOwnMetadata(metadataKey, target, targetKey) {
    if (!IsObject(target)) {
      throw new TypeError();
    }
    else if (!IsUndefined(targetKey)) {
      targetKey = ToPropertyKey(targetKey);
    }
    return OrdinaryGetOwnMetadata(metadataKey, target, targetKey);
  }
  Reflect.getOwnMetadata = getOwnMetadata;
  /**
   * Gets the metadata keys defined on the target object or its prototype chain.
   * @param target The target object on which the metadata is defined.
   * @param targetKey (Optional) The property key for the target.
   * @returns An array of unique metadata keys.
   * @example
   *
   *     class C {
      *         // property declarations are not part of ES6, though they are valid in TypeScript:
      *         // static staticProperty;
      *         // property;
      *
      *         constructor(p) { }
      *         static staticMethod(p) { }
      *         method(p) { }
      *     }
   *
   *     // constructor
   *     result = Reflect.getMetadataKeys(C);
   *
   *     // property (on constructor)
   *     result = Reflect.getMetadataKeys(C, "staticProperty");
   *
   *     // property (on prototype)
   *     result = Reflect.getMetadataKeys(C.prototype, "property");
   *
   *     // method (on constructor)
   *     result = Reflect.getMetadataKeys(C, "staticMethod");
   *
   *     // method (on prototype)
   *     result = Reflect.getMetadataKeys(C.prototype, "method");
   *
   */
  function getMetadataKeys(target, targetKey) {
    if (!IsObject(target)) {
      throw new TypeError();
    }
    else if (!IsUndefined(targetKey)) {
      targetKey = ToPropertyKey(targetKey);
    }
    return OrdinaryMetadataKeys(target, targetKey);
  }
  Reflect.getMetadataKeys = getMetadataKeys;
  /**
   * Gets the unique metadata keys defined on the target object.
   * @param target The target object on which the metadata is defined.
   * @param targetKey (Optional) The property key for the target.
   * @returns An array of unique metadata keys.
   * @example
   *
   *     class C {
      *         // property declarations are not part of ES6, though they are valid in TypeScript:
      *         // static staticProperty;
      *         // property;
      *
      *         constructor(p) { }
      *         static staticMethod(p) { }
      *         method(p) { }
      *     }
   *
   *     // constructor
   *     result = Reflect.getOwnMetadataKeys(C);
   *
   *     // property (on constructor)
   *     result = Reflect.getOwnMetadataKeys(C, "staticProperty");
   *
   *     // property (on prototype)
   *     result = Reflect.getOwnMetadataKeys(C.prototype, "property");
   *
   *     // method (on constructor)
   *     result = Reflect.getOwnMetadataKeys(C, "staticMethod");
   *
   *     // method (on prototype)
   *     result = Reflect.getOwnMetadataKeys(C.prototype, "method");
   *
   */
  function getOwnMetadataKeys(target, targetKey) {
    if (!IsObject(target)) {
      throw new TypeError();
    }
    else if (!IsUndefined(targetKey)) {
      targetKey = ToPropertyKey(targetKey);
    }
    return OrdinaryOwnMetadataKeys(target, targetKey);
  }
  Reflect.getOwnMetadataKeys = getOwnMetadataKeys;
  /**
   * Deletes the metadata entry from the target object with the provided key.
   * @param metadataKey A key used to store and retrieve metadata.
   * @param target The target object on which the metadata is defined.
   * @param targetKey (Optional) The property key for the target.
   * @returns `true` if the metadata entry was found and deleted; otherwise, false.
   * @example
   *
   *     class C {
      *         // property declarations are not part of ES6, though they are valid in TypeScript:
      *         // static staticProperty;
      *         // property;
      *
      *         constructor(p) { }
      *         static staticMethod(p) { }
      *         method(p) { }
      *     }
   *
   *     // constructor
   *     result = Reflect.deleteMetadata("custom:annotation", C);
   *
   *     // property (on constructor)
   *     result = Reflect.deleteMetadata("custom:annotation", C, "staticProperty");
   *
   *     // property (on prototype)
   *     result = Reflect.deleteMetadata("custom:annotation", C.prototype, "property");
   *
   *     // method (on constructor)
   *     result = Reflect.deleteMetadata("custom:annotation", C, "staticMethod");
   *
   *     // method (on prototype)
   *     result = Reflect.deleteMetadata("custom:annotation", C.prototype, "method");
   *
   */
  function deleteMetadata(metadataKey, target, targetKey) {
    if (!IsObject(target)) {
      throw new TypeError();
    }
    else if (!IsUndefined(targetKey)) {
      targetKey = ToPropertyKey(targetKey);
    }
    // https://github.com/jonathandturner/decorators/blob/master/specs/metadata.md#deletemetadata-metadatakey-p-
    var metadataMap = GetOrCreateMetadataMap(target, targetKey, false);
    if (IsUndefined(metadataMap)) {
      return undefined;
    }
    if (!metadataMap.delete(metadataKey)) {
      return false;
    }
    if (metadataMap.size > 0) {
      return true;
    }
    var targetMetadata = __Metadata__.get(target);
    targetMetadata.delete(targetKey);
    if (targetMetadata.size > 0) {
      return true;
    }
    __Metadata__.delete(target);
    return true;
  }
  Reflect.deleteMetadata = deleteMetadata;
  function DecorateConstructor(decorators, target) {
    for (var i = decorators.length - 1; i >= 0; --i) {
      var decorator = decorators[i];
      var decorated = decorator(target);
      if (!IsUndefined(decorated)) {
        if (!IsConstructor(decorated)) {
          throw new TypeError();
        }
        target = decorated;
      }
    }
    return target;
  }
  function DecoratePropertyWithDescriptor(decorators, target, propertyKey, descriptor) {
    for (var i = decorators.length - 1; i >= 0; --i) {
      var decorator = decorators[i];
      var decorated = decorator(target, propertyKey, descriptor);
      if (!IsUndefined(decorated)) {
        if (!IsObject(decorated)) {
          throw new TypeError();
        }
        descriptor = decorated;
      }
    }
    return descriptor;
  }
  function DecoratePropertyWithoutDescriptor(decorators, target, propertyKey) {
    for (var i = decorators.length - 1; i >= 0; --i) {
      var decorator = decorators[i];
      decorator(target, propertyKey);
    }
  }
  // https://github.com/jonathandturner/decorators/blob/master/specs/metadata.md#getorcreatemetadatamap--o-p-create-
  function GetOrCreateMetadataMap(target, targetKey, create) {
    var targetMetadata = __Metadata__.get(target);
    if (!targetMetadata) {
      if (!create) {
        return undefined;
      }
      targetMetadata = new _Map();
      __Metadata__.set(target, targetMetadata);
    }
    var keyMetadata = targetMetadata.get(targetKey);
    if (!keyMetadata) {
      if (!create) {
        return undefined;
      }
      keyMetadata = new _Map();
      targetMetadata.set(targetKey, keyMetadata);
    }
    return keyMetadata;
  }
  // https://github.com/jonathandturner/decorators/blob/master/specs/metadata.md#ordinaryhasmetadata--metadatakey-o-p-
  function OrdinaryHasMetadata(MetadataKey, O, P) {
    var hasOwn = OrdinaryHasOwnMetadata(MetadataKey, O, P);
    if (hasOwn) {
      return true;
    }
    var parent = GetPrototypeOf(O);
    if (parent !== null) {
      return OrdinaryHasMetadata(MetadataKey, parent, P);
    }
    return false;
  }
  // https://github.com/jonathandturner/decorators/blob/master/specs/metadata.md#ordinaryhasownmetadata--metadatakey-o-p-
  function OrdinaryHasOwnMetadata(MetadataKey, O, P) {
    var metadataMap = GetOrCreateMetadataMap(O, P, false);
    if (metadataMap === undefined) {
      return false;
    }
    return Boolean(metadataMap.has(MetadataKey));
  }
  // https://github.com/jonathandturner/decorators/blob/master/specs/metadata.md#ordinarygetmetadata--metadatakey-o-p-
  function OrdinaryGetMetadata(MetadataKey, O, P) {
    var hasOwn = OrdinaryHasOwnMetadata(MetadataKey, O, P);
    if (hasOwn) {
      return OrdinaryGetOwnMetadata(MetadataKey, O, P);
    }
    var parent = GetPrototypeOf(O);
    if (parent !== null) {
      return OrdinaryGetMetadata(MetadataKey, parent, P);
    }
    return undefined;
  }
  // https://github.com/jonathandturner/decorators/blob/master/specs/metadata.md#ordinarygetownmetadata--metadatakey-o-p-
  function OrdinaryGetOwnMetadata(MetadataKey, O, P) {
    var metadataMap = GetOrCreateMetadataMap(O, P, false);
    if (metadataMap === undefined) {
      return undefined;
    }
    return metadataMap.get(MetadataKey);
  }
  // https://github.com/jonathandturner/decorators/blob/master/specs/metadata.md#ordinarydefineownmetadata--metadatakey-metadatavalue-o-p-
  function OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P) {
    var metadataMap = GetOrCreateMetadataMap(O, P, true);
    metadataMap.set(MetadataKey, MetadataValue);
  }
  // https://github.com/jonathandturner/decorators/blob/master/specs/metadata.md#ordinarymetadatakeys--o-p-
  function OrdinaryMetadataKeys(O, P) {
    var ownKeys = OrdinaryOwnMetadataKeys(O, P);
    var parent = GetPrototypeOf(O);
    if (parent === null) {
      return ownKeys;
    }
    var parentKeys = OrdinaryMetadataKeys(parent, P);
    if (parentKeys.length <= 0) {
      return ownKeys;
    }
    if (ownKeys.length <= 0) {
      return parentKeys;
    }
    var set = new _Set();
    var keys = [];
    for (var _i = 0; _i < ownKeys.length; _i++) {
      var key = ownKeys[_i];
      var hasKey = set.has(key);
      if (!hasKey) {
        set.add(key);
        keys.push(key);
      }
    }
    for (var _a = 0; _a < parentKeys.length; _a++) {
      var key = parentKeys[_a];
      var hasKey = set.has(key);
      if (!hasKey) {
        set.add(key);
        keys.push(key);
      }
    }
    return keys;
  }
  // https://github.com/jonathandturner/decorators/blob/master/specs/metadata.md#ordinaryownmetadatakeys--o-p-
  function OrdinaryOwnMetadataKeys(target, targetKey) {
    var metadataMap = GetOrCreateMetadataMap(target, targetKey, false);
    var keys = [];
    if (metadataMap) {
      metadataMap.forEach(function (_, key) { return keys.push(key); });
    }
    return keys;
  }
  // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-ecmascript-language-types-undefined-type
  function IsUndefined(x) {
    return x === undefined;
  }
  // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-isarray
  function IsArray(x) {
    return Array.isArray(x);
  }
  // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-object-type
  function IsObject(x) {
    return typeof x === "object" ? x !== null : typeof x === "function";
  }
  // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-isconstructor
  function IsConstructor(x) {
    return typeof x === "function";
  }
  // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-ecmascript-language-types-symbol-type
  function IsSymbol(x) {
    return typeof x === "symbol";
  }
  // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-topropertykey
  function ToPropertyKey(value) {
    if (IsSymbol(value)) {
      return value;
    }
    return String(value);
  }
  function GetPrototypeOf(O) {
    var proto = Object.getPrototypeOf(O);
    if (typeof O !== "function" || O === functionPrototype) {
      return proto;
    }
    // TypeScript doesn't set __proto__ in ES5, as it's non-standard. 
    // Try to determine the superclass constructor. Compatible implementations
    // must either set __proto__ on a subclass constructor to the superclass constructor,
    // or ensure each class has a valid `constructor` property on its prototype that
    // points back to the constructor.
    // If this is not the same as Function.[[Prototype]], then this is definately inherited.
    // This is the case when in ES6 or when using __proto__ in a compatible browser.
    if (proto !== functionPrototype) {
      return proto;
    }
    // If the super prototype is Object.prototype, null, or undefined, then we cannot determine the heritage.
    var prototype = O.prototype;
    var prototypeProto = Object.getPrototypeOf(prototype);
    if (prototypeProto == null || prototypeProto === Object.prototype) {
      return proto;
    }
    // if the constructor was not a function, then we cannot determine the heritage.
    var constructor = prototypeProto.constructor;
    if (typeof constructor !== "function") {
      return proto;
    }
    // if we have some kind of self-reference, then we cannot determine the heritage.
    if (constructor === O) {
      return proto;
    }
    // we have a pretty good guess at the heritage.
    return constructor;
  }
  // naive Map shim
  function CreateMapPolyfill() {
    var cacheSentinel = {};
    function Map() {
      this._keys = [];
      this._values = [];
      this._cache = cacheSentinel;
    }
    Map.prototype = {
      get size() {
        return this._keys.length;
      },
      has: function (key) {
        if (key === this._cache) {
          return true;
        }
        if (this._find(key) >= 0) {
          this._cache = key;
          return true;
        }
        return false;
      },
      get: function (key) {
        var index = this._find(key);
        if (index >= 0) {
          this._cache = key;
          return this._values[index];
        }
        return undefined;
      },
      set: function (key, value) {
        this.delete(key);
        this._keys.push(key);
        this._values.push(value);
        this._cache = key;
        return this;
      },
      delete: function (key) {
        var index = this._find(key);
        if (index >= 0) {
          this._keys.splice(index, 1);
          this._values.splice(index, 1);
          this._cache = cacheSentinel;
          return true;
        }
        return false;
      },
      clear: function () {
        this._keys.length = 0;
        this._values.length = 0;
        this._cache = cacheSentinel;
      },
      forEach: function (callback, thisArg) {
        var size = this.size;
        for (var i = 0; i < size; ++i) {
          var key = this._keys[i];
          var value = this._values[i];
          this._cache = key;
          callback.call(this, value, key, this);
        }
      },
      _find: function (key) {
        var keys = this._keys;
        var size = keys.length;
        for (var i = 0; i < size; ++i) {
          if (keys[i] === key) {
            return i;
          }
        }
        return -1;
      }
    };
    return Map;
  }
  // naive Set shim
  function CreateSetPolyfill() {
    var cacheSentinel = {};
    function Set() {
      this._map = new _Map();
    }
    Set.prototype = {
      get size() {
        return this._map.length;
      },
      has: function (value) {
        return this._map.has(value);
      },
      add: function (value) {
        this._map.set(value, value);
        return this;
      },
      delete: function (value) {
        return this._map.delete(value);
      },
      clear: function () {
        this._map.clear();
      },
      forEach: function (callback, thisArg) {
        this._map.forEach(callback, thisArg);
      }
    };
    return Set;
  }
  // naive WeakMap shim
  function CreateWeakMapPolyfill() {
    var UUID_SIZE = 16;
    var isNode = typeof global !== "undefined" &&
      typeof module === "object" &&
      typeof module.exports === "object" &&
      typeof require === "function";
    var nodeCrypto = isNode && require("crypto");
    var hasOwn = Object.prototype.hasOwnProperty;
    var keys = {};
    var rootKey = CreateUniqueKey();
    function WeakMap() {
      this._key = CreateUniqueKey();
    }
    WeakMap.prototype = {
      has: function (target) {
        var table = GetOrCreateWeakMapTable(target, false);
        if (table) {
          return this._key in table;
        }
        return false;
      },
      get: function (target) {
        var table = GetOrCreateWeakMapTable(target, false);
        if (table) {
          return table[this._key];
        }
        return undefined;
      },
      set: function (target, value) {
        var table = GetOrCreateWeakMapTable(target, true);
        table[this._key] = value;
        return this;
      },
      delete: function (target) {
        var table = GetOrCreateWeakMapTable(target, false);
        if (table && this._key in table) {
          return delete table[this._key];
        }
        return false;
      },
      clear: function () {
        // NOTE: not a real clear, just makes the previous data unreachable
        this._key = CreateUniqueKey();
      }
    };
    function FillRandomBytes(buffer, size) {
      for (var i = 0; i < size; ++i) {
        buffer[i] = Math.random() * 255 | 0;
      }
    }
    function GenRandomBytes(size) {
      if (nodeCrypto) {
        var data = nodeCrypto.randomBytes(size);
        return data;
      }
      else if (typeof Uint8Array === "function") {
        var data = new Uint8Array(size);
        if (typeof crypto !== "undefined") {
          crypto.getRandomValues(data);
        }
        else if (typeof msCrypto !== "undefined") {
          msCrypto.getRandomValues(data);
        }
        else {
          FillRandomBytes(data, size);
        }
        return data;
      }
      else {
        var data = new Array(size);
        FillRandomBytes(data, size);
        return data;
      }
    }
    function CreateUUID() {
      var data = GenRandomBytes(UUID_SIZE);
      // mark as random - RFC 4122 � 4.4
      data[6] = data[6] & 0x4f | 0x40;
      data[8] = data[8] & 0xbf | 0x80;
      var result = "";
      for (var offset = 0; offset < UUID_SIZE; ++offset) {
        var byte = data[offset];
        if (offset === 4 || offset === 6 || offset === 8) {
          result += "-";
        }
        if (byte < 16) {
          result += "0";
        }
        result += byte.toString(16).toLowerCase();
      }
      return result;
    }
    function CreateUniqueKey() {
      var key;
      do {
        key = "@@WeakMap@@" + CreateUUID();
      } while (hasOwn.call(keys, key));
      keys[key] = true;
      return key;
    }
    function GetOrCreateWeakMapTable(target, create) {
      if (!hasOwn.call(target, rootKey)) {
        if (!create) {
          return undefined;
        }
        Object.defineProperty(target, rootKey, { value: Object.create(null) });
      }
      return target[rootKey];
    }
    return WeakMap;
  }
  // hook global Reflect
  (function (__global) {
    if (typeof __global.Reflect !== "undefined") {
      if (__global.Reflect !== Reflect) {
        for (var p in Reflect) {
          __global.Reflect[p] = Reflect[p];
        }
      }
    }
    else {
      __global.Reflect = Reflect;
    }
  })(typeof window !== "undefined" ? window :
    typeof WorkerGlobalScope !== "undefined" ? self :
      typeof global !== "undefined" ? global :
        Function("return this;")());
})(Reflect || (Reflect = {}));
//# sourceMappingURLDisabled=Reflect.js.map
"format register";
System.register("rx/dist/rx.all", [], true, function(require, exports, module) {
  var global = System.global,
    __define = global.define;
  global.define = undefined;
  ;
  (function(undefined) {
    var objectTypes = {
      'boolean': false,
      'function': true,
      'object': true,
      'number': false,
      'string': false,
      'undefined': false
    };
    var root = (objectTypes[typeof window] && window) || this,
      freeExports = objectTypes[typeof exports] && exports && !exports.nodeType && exports,
      freeModule = objectTypes[typeof module] && module && !module.nodeType && module,
      moduleExports = freeModule && freeModule.exports === freeExports && freeExports,
      freeGlobal = objectTypes[typeof global] && global;
    if (freeGlobal && (freeGlobal.global === freeGlobal || freeGlobal.window === freeGlobal)) {
      root = freeGlobal;
    }
    var Rx = {
      internals: {},
      config: {Promise: root.Promise},
      helpers: {}
    };
    var noop = Rx.helpers.noop = function() {},
      notDefined = Rx.helpers.notDefined = function(x) {
        return typeof x === 'undefined';
      },
      isScheduler = Rx.helpers.isScheduler = function(x) {
        return x instanceof Rx.Scheduler;
      },
      identity = Rx.helpers.identity = function(x) {
        return x;
      },
      pluck = Rx.helpers.pluck = function(property) {
        return function(x) {
          return x[property];
        };
      },
      just = Rx.helpers.just = function(value) {
        return function() {
          return value;
        };
      },
      defaultNow = Rx.helpers.defaultNow = Date.now,
      defaultComparer = Rx.helpers.defaultComparer = function(x, y) {
        return isEqual(x, y);
      },
      defaultSubComparer = Rx.helpers.defaultSubComparer = function(x, y) {
        return x > y ? 1 : (x < y ? -1 : 0);
      },
      defaultKeySerializer = Rx.helpers.defaultKeySerializer = function(x) {
        return x.toString();
      },
      defaultError = Rx.helpers.defaultError = function(err) {
        throw err;
      },
      isPromise = Rx.helpers.isPromise = function(p) {
        return !!p && typeof p.then === 'function';
      },
      asArray = Rx.helpers.asArray = function() {
        return Array.prototype.slice.call(arguments);
      },
      not = Rx.helpers.not = function(a) {
        return !a;
      },
      isFunction = Rx.helpers.isFunction = (function() {
        var isFn = function(value) {
          return typeof value == 'function' || false;
        };
        if (isFn(/x/)) {
          isFn = function(value) {
            return typeof value == 'function' && toString.call(value) == '[object Function]';
          };
        }
        return isFn;
      }());
    function cloneArray(arr) {
      for (var a = [],
             i = 0,
             len = arr.length; i < len; i++) {
        a.push(arr[i]);
      }
      return a;
    }
    Rx.config.longStackSupport = false;
    var hasStacks = false;
    try {
      throw new Error();
    } catch (e) {
      hasStacks = !!e.stack;
    }
    var rStartingLine = captureLine(),
      rFileName;
    var STACK_JUMP_SEPARATOR = "From previous event:";
    function makeStackTraceLong(error, observable) {
      if (hasStacks && observable.stack && typeof error === "object" && error !== null && error.stack && error.stack.indexOf(STACK_JUMP_SEPARATOR) === -1) {
        var stacks = [];
        for (var o = observable; !!o; o = o.source) {
          if (o.stack) {
            stacks.unshift(o.stack);
          }
        }
        stacks.unshift(error.stack);
        var concatedStacks = stacks.join("\n" + STACK_JUMP_SEPARATOR + "\n");
        error.stack = filterStackString(concatedStacks);
      }
    }
    function filterStackString(stackString) {
      var lines = stackString.split("\n"),
        desiredLines = [];
      for (var i = 0,
             len = lines.length; i < len; i++) {
        var line = lines[i];
        if (!isInternalFrame(line) && !isNodeFrame(line) && line) {
          desiredLines.push(line);
        }
      }
      return desiredLines.join("\n");
    }
    function isInternalFrame(stackLine) {
      var fileNameAndLineNumber = getFileNameAndLineNumber(stackLine);
      if (!fileNameAndLineNumber) {
        return false;
      }
      var fileName = fileNameAndLineNumber[0],
        lineNumber = fileNameAndLineNumber[1];
      return fileName === rFileName && lineNumber >= rStartingLine && lineNumber <= rEndingLine;
    }
    function isNodeFrame(stackLine) {
      return stackLine.indexOf("(module.js:") !== -1 || stackLine.indexOf("(node.js:") !== -1;
    }
    function captureLine() {
      if (!hasStacks) {
        return ;
      }
      try {
        throw new Error();
      } catch (e) {
        var lines = e.stack.split("\n");
        var firstLine = lines[0].indexOf("@") > 0 ? lines[1] : lines[2];
        var fileNameAndLineNumber = getFileNameAndLineNumber(firstLine);
        if (!fileNameAndLineNumber) {
          return ;
        }
        rFileName = fileNameAndLineNumber[0];
        return fileNameAndLineNumber[1];
      }
    }
    function getFileNameAndLineNumber(stackLine) {
      var attempt1 = /at .+ \((.+):(\d+):(?:\d+)\)$/.exec(stackLine);
      if (attempt1) {
        return [attempt1[1], Number(attempt1[2])];
      }
      var attempt2 = /at ([^ ]+):(\d+):(?:\d+)$/.exec(stackLine);
      if (attempt2) {
        return [attempt2[1], Number(attempt2[2])];
      }
      var attempt3 = /.*@(.+):(\d+)$/.exec(stackLine);
      if (attempt3) {
        return [attempt3[1], Number(attempt3[2])];
      }
    }
    var EmptyError = Rx.EmptyError = function() {
      this.message = 'Sequence contains no elements.';
      Error.call(this);
    };
    EmptyError.prototype = Error.prototype;
    var ObjectDisposedError = Rx.ObjectDisposedError = function() {
      this.message = 'Object has been disposed';
      Error.call(this);
    };
    ObjectDisposedError.prototype = Error.prototype;
    var ArgumentOutOfRangeError = Rx.ArgumentOutOfRangeError = function() {
      this.message = 'Argument out of range';
      Error.call(this);
    };
    ArgumentOutOfRangeError.prototype = Error.prototype;
    var NotSupportedError = Rx.NotSupportedError = function(message) {
      this.message = message || 'This operation is not supported';
      Error.call(this);
    };
    NotSupportedError.prototype = Error.prototype;
    var NotImplementedError = Rx.NotImplementedError = function(message) {
      this.message = message || 'This operation is not implemented';
      Error.call(this);
    };
    NotImplementedError.prototype = Error.prototype;
    var notImplemented = Rx.helpers.notImplemented = function() {
      throw new NotImplementedError();
    };
    var notSupported = Rx.helpers.notSupported = function() {
      throw new NotSupportedError();
    };
    var $iterator$ = (typeof Symbol === 'function' && Symbol.iterator) || '_es6shim_iterator_';
    if (root.Set && typeof new root.Set()['@@iterator'] === 'function') {
      $iterator$ = '@@iterator';
    }
    var doneEnumerator = Rx.doneEnumerator = {
      done: true,
      value: undefined
    };
    var isIterable = Rx.helpers.isIterable = function(o) {
      return o[$iterator$] !== undefined;
    };
    var isArrayLike = Rx.helpers.isArrayLike = function(o) {
      return o && o.length !== undefined;
    };
    Rx.helpers.iterator = $iterator$;
    var bindCallback = Rx.internals.bindCallback = function(func, thisArg, argCount) {
      if (typeof thisArg === 'undefined') {
        return func;
      }
      switch (argCount) {
        case 0:
          return function() {
            return func.call(thisArg);
          };
        case 1:
          return function(arg) {
            return func.call(thisArg, arg);
          };
        case 2:
          return function(value, index) {
            return func.call(thisArg, value, index);
          };
        case 3:
          return function(value, index, collection) {
            return func.call(thisArg, value, index, collection);
          };
      }
      return function() {
        return func.apply(thisArg, arguments);
      };
    };
    var dontEnums = ['toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'constructor'],
      dontEnumsLength = dontEnums.length;
    var argsClass = '[object Arguments]',
      arrayClass = '[object Array]',
      boolClass = '[object Boolean]',
      dateClass = '[object Date]',
      errorClass = '[object Error]',
      funcClass = '[object Function]',
      numberClass = '[object Number]',
      objectClass = '[object Object]',
      regexpClass = '[object RegExp]',
      stringClass = '[object String]';
    var toString = Object.prototype.toString,
      hasOwnProperty = Object.prototype.hasOwnProperty,
      supportsArgsClass = toString.call(arguments) == argsClass,
      supportNodeClass,
      errorProto = Error.prototype,
      objectProto = Object.prototype,
      stringProto = String.prototype,
      propertyIsEnumerable = objectProto.propertyIsEnumerable;
    try {
      supportNodeClass = !(toString.call(document) == objectClass && !({'toString': 0} + ''));
    } catch (e) {
      supportNodeClass = true;
    }
    var nonEnumProps = {};
    nonEnumProps[arrayClass] = nonEnumProps[dateClass] = nonEnumProps[numberClass] = {
      'constructor': true,
      'toLocaleString': true,
      'toString': true,
      'valueOf': true
    };
    nonEnumProps[boolClass] = nonEnumProps[stringClass] = {
      'constructor': true,
      'toString': true,
      'valueOf': true
    };
    nonEnumProps[errorClass] = nonEnumProps[funcClass] = nonEnumProps[regexpClass] = {
      'constructor': true,
      'toString': true
    };
    nonEnumProps[objectClass] = {'constructor': true};
    var support = {};
    (function() {
      var ctor = function() {
          this.x = 1;
        },
        props = [];
      ctor.prototype = {
        'valueOf': 1,
        'y': 1
      };
      for (var key in new ctor) {
        props.push(key);
      }
      for (key in arguments) {}
      support.enumErrorProps = propertyIsEnumerable.call(errorProto, 'message') || propertyIsEnumerable.call(errorProto, 'name');
      support.enumPrototypes = propertyIsEnumerable.call(ctor, 'prototype');
      support.nonEnumArgs = key != 0;
      support.nonEnumShadows = !/valueOf/.test(props);
    }(1));
    var isObject = Rx.internals.isObject = function(value) {
      var type = typeof value;
      return value && (type == 'function' || type == 'object') || false;
    };
    function keysIn(object) {
      var result = [];
      if (!isObject(object)) {
        return result;
      }
      if (support.nonEnumArgs && object.length && isArguments(object)) {
        object = slice.call(object);
      }
      var skipProto = support.enumPrototypes && typeof object == 'function',
        skipErrorProps = support.enumErrorProps && (object === errorProto || object instanceof Error);
      for (var key in object) {
        if (!(skipProto && key == 'prototype') && !(skipErrorProps && (key == 'message' || key == 'name'))) {
          result.push(key);
        }
      }
      if (support.nonEnumShadows && object !== objectProto) {
        var ctor = object.constructor,
          index = -1,
          length = dontEnumsLength;
        if (object === (ctor && ctor.prototype)) {
          var className = object === stringProto ? stringClass : object === errorProto ? errorClass : toString.call(object),
            nonEnum = nonEnumProps[className];
        }
        while (++index < length) {
          key = dontEnums[index];
          if (!(nonEnum && nonEnum[key]) && hasOwnProperty.call(object, key)) {
            result.push(key);
          }
        }
      }
      return result;
    }
    function internalFor(object, callback, keysFunc) {
      var index = -1,
        props = keysFunc(object),
        length = props.length;
      while (++index < length) {
        var key = props[index];
        if (callback(object[key], key, object) === false) {
          break;
        }
      }
      return object;
    }
    function internalForIn(object, callback) {
      return internalFor(object, callback, keysIn);
    }
    function isNode(value) {
      return typeof value.toString != 'function' && typeof(value + '') == 'string';
    }
    var isArguments = function(value) {
      return (value && typeof value == 'object') ? toString.call(value) == argsClass : false;
    };
    if (!supportsArgsClass) {
      isArguments = function(value) {
        return (value && typeof value == 'object') ? hasOwnProperty.call(value, 'callee') : false;
      };
    }
    var isEqual = Rx.internals.isEqual = function(x, y) {
      return deepEquals(x, y, [], []);
    };
    function deepEquals(a, b, stackA, stackB) {
      if (a === b) {
        return a !== 0 || (1 / a == 1 / b);
      }
      var type = typeof a,
        otherType = typeof b;
      if (a === a && (a == null || b == null || (type != 'function' && type != 'object' && otherType != 'function' && otherType != 'object'))) {
        return false;
      }
      var className = toString.call(a),
        otherClass = toString.call(b);
      if (className == argsClass) {
        className = objectClass;
      }
      if (otherClass == argsClass) {
        otherClass = objectClass;
      }
      if (className != otherClass) {
        return false;
      }
      switch (className) {
        case boolClass:
        case dateClass:
          return +a == +b;
        case numberClass:
          return (a != +a) ? b != +b : (a == 0 ? (1 / a == 1 / b) : a == +b);
        case regexpClass:
        case stringClass:
          return a == String(b);
      }
      var isArr = className == arrayClass;
      if (!isArr) {
        if (className != objectClass || (!support.nodeClass && (isNode(a) || isNode(b)))) {
          return false;
        }
        var ctorA = !support.argsObject && isArguments(a) ? Object : a.constructor,
          ctorB = !support.argsObject && isArguments(b) ? Object : b.constructor;
        if (ctorA != ctorB && !(hasOwnProperty.call(a, 'constructor') && hasOwnProperty.call(b, 'constructor')) && !(isFunction(ctorA) && ctorA instanceof ctorA && isFunction(ctorB) && ctorB instanceof ctorB) && ('constructor' in a && 'constructor' in b)) {
          return false;
        }
      }
      var initedStack = !stackA;
      stackA || (stackA = []);
      stackB || (stackB = []);
      var length = stackA.length;
      while (length--) {
        if (stackA[length] == a) {
          return stackB[length] == b;
        }
      }
      var size = 0;
      var result = true;
      stackA.push(a);
      stackB.push(b);
      if (isArr) {
        length = a.length;
        size = b.length;
        result = size == length;
        if (result) {
          while (size--) {
            var index = length,
              value = b[size];
            if (!(result = deepEquals(a[size], value, stackA, stackB))) {
              break;
            }
          }
        }
      } else {
        internalForIn(b, function(value, key, b) {
          if (hasOwnProperty.call(b, key)) {
            size++;
            return (result = hasOwnProperty.call(a, key) && deepEquals(a[key], value, stackA, stackB));
          }
        });
        if (result) {
          internalForIn(a, function(value, key, a) {
            if (hasOwnProperty.call(a, key)) {
              return (result = --size > -1);
            }
          });
        }
      }
      stackA.pop();
      stackB.pop();
      return result;
    }
    var hasProp = {}.hasOwnProperty,
      slice = Array.prototype.slice;
    var inherits = this.inherits = Rx.internals.inherits = function(child, parent) {
      function __() {
        this.constructor = child;
      }
      __.prototype = parent.prototype;
      child.prototype = new __();
    };
    var addProperties = Rx.internals.addProperties = function(obj) {
      for (var sources = [],
             i = 1,
             len = arguments.length; i < len; i++) {
        sources.push(arguments[i]);
      }
      for (var idx = 0,
             ln = sources.length; idx < ln; idx++) {
        var source = sources[idx];
        for (var prop in source) {
          obj[prop] = source[prop];
        }
      }
    };
    var addRef = Rx.internals.addRef = function(xs, r) {
      return new AnonymousObservable(function(observer) {
        return new CompositeDisposable(r.getDisposable(), xs.subscribe(observer));
      });
    };
    function arrayInitialize(count, factory) {
      var a = new Array(count);
      for (var i = 0; i < count; i++) {
        a[i] = factory();
      }
      return a;
    }
    var errorObj = {e: {}};
    var tryCatchTarget;
    function tryCatcher() {
      try {
        return tryCatchTarget.apply(this, arguments);
      } catch (e) {
        errorObj.e = e;
        return errorObj;
      }
    }
    function tryCatch(fn) {
      if (!isFunction(fn)) {
        throw new TypeError('fn must be a function');
      }
      tryCatchTarget = fn;
      return tryCatcher;
    }
    function thrower(e) {
      throw e;
    }
    function IndexedItem(id, value) {
      this.id = id;
      this.value = value;
    }
    IndexedItem.prototype.compareTo = function(other) {
      var c = this.value.compareTo(other.value);
      c === 0 && (c = this.id - other.id);
      return c;
    };
    var PriorityQueue = Rx.internals.PriorityQueue = function(capacity) {
      this.items = new Array(capacity);
      this.length = 0;
    };
    var priorityProto = PriorityQueue.prototype;
    priorityProto.isHigherPriority = function(left, right) {
      return this.items[left].compareTo(this.items[right]) < 0;
    };
    priorityProto.percolate = function(index) {
      if (index >= this.length || index < 0) {
        return ;
      }
      var parent = index - 1 >> 1;
      if (parent < 0 || parent === index) {
        return ;
      }
      if (this.isHigherPriority(index, parent)) {
        var temp = this.items[index];
        this.items[index] = this.items[parent];
        this.items[parent] = temp;
        this.percolate(parent);
      }
    };
    priorityProto.heapify = function(index) {
      +index || (index = 0);
      if (index >= this.length || index < 0) {
        return ;
      }
      var left = 2 * index + 1,
        right = 2 * index + 2,
        first = index;
      if (left < this.length && this.isHigherPriority(left, first)) {
        first = left;
      }
      if (right < this.length && this.isHigherPriority(right, first)) {
        first = right;
      }
      if (first !== index) {
        var temp = this.items[index];
        this.items[index] = this.items[first];
        this.items[first] = temp;
        this.heapify(first);
      }
    };
    priorityProto.peek = function() {
      return this.items[0].value;
    };
    priorityProto.removeAt = function(index) {
      this.items[index] = this.items[--this.length];
      this.items[this.length] = undefined;
      this.heapify();
    };
    priorityProto.dequeue = function() {
      var result = this.peek();
      this.removeAt(0);
      return result;
    };
    priorityProto.enqueue = function(item) {
      var index = this.length++;
      this.items[index] = new IndexedItem(PriorityQueue.count++, item);
      this.percolate(index);
    };
    priorityProto.remove = function(item) {
      for (var i = 0; i < this.length; i++) {
        if (this.items[i].value === item) {
          this.removeAt(i);
          return true;
        }
      }
      return false;
    };
    PriorityQueue.count = 0;
    var CompositeDisposable = Rx.CompositeDisposable = function() {
      var args = [],
        i,
        len;
      if (Array.isArray(arguments[0])) {
        args = arguments[0];
        len = args.length;
      } else {
        len = arguments.length;
        args = new Array(len);
        for (i = 0; i < len; i++) {
          args[i] = arguments[i];
        }
      }
      for (i = 0; i < len; i++) {
        if (!isDisposable(args[i])) {
          throw new TypeError('Not a disposable');
        }
      }
      this.disposables = args;
      this.isDisposed = false;
      this.length = args.length;
    };
    var CompositeDisposablePrototype = CompositeDisposable.prototype;
    CompositeDisposablePrototype.add = function(item) {
      if (this.isDisposed) {
        item.dispose();
      } else {
        this.disposables.push(item);
        this.length++;
      }
    };
    CompositeDisposablePrototype.remove = function(item) {
      var shouldDispose = false;
      if (!this.isDisposed) {
        var idx = this.disposables.indexOf(item);
        if (idx !== -1) {
          shouldDispose = true;
          this.disposables.splice(idx, 1);
          this.length--;
          item.dispose();
        }
      }
      return shouldDispose;
    };
    CompositeDisposablePrototype.dispose = function() {
      if (!this.isDisposed) {
        this.isDisposed = true;
        var len = this.disposables.length,
          currentDisposables = new Array(len);
        for (var i = 0; i < len; i++) {
          currentDisposables[i] = this.disposables[i];
        }
        this.disposables = [];
        this.length = 0;
        for (i = 0; i < len; i++) {
          currentDisposables[i].dispose();
        }
      }
    };
    var Disposable = Rx.Disposable = function(action) {
      this.isDisposed = false;
      this.action = action || noop;
    };
    Disposable.prototype.dispose = function() {
      if (!this.isDisposed) {
        this.action();
        this.isDisposed = true;
      }
    };
    var disposableCreate = Disposable.create = function(action) {
      return new Disposable(action);
    };
    var disposableEmpty = Disposable.empty = {dispose: noop};
    var isDisposable = Disposable.isDisposable = function(d) {
      return d && isFunction(d.dispose);
    };
    var checkDisposed = Disposable.checkDisposed = function(disposable) {
      if (disposable.isDisposed) {
        throw new ObjectDisposedError();
      }
    };
    var SingleAssignmentDisposable = Rx.SingleAssignmentDisposable = (function() {
      function BooleanDisposable() {
        this.isDisposed = false;
        this.current = null;
      }
      var booleanDisposablePrototype = BooleanDisposable.prototype;
      booleanDisposablePrototype.getDisposable = function() {
        return this.current;
      };
      booleanDisposablePrototype.setDisposable = function(value) {
        var shouldDispose = this.isDisposed;
        if (!shouldDispose) {
          var old = this.current;
          this.current = value;
        }
        old && old.dispose();
        shouldDispose && value && value.dispose();
      };
      booleanDisposablePrototype.dispose = function() {
        if (!this.isDisposed) {
          this.isDisposed = true;
          var old = this.current;
          this.current = null;
        }
        old && old.dispose();
      };
      return BooleanDisposable;
    }());
    var SerialDisposable = Rx.SerialDisposable = SingleAssignmentDisposable;
    var RefCountDisposable = Rx.RefCountDisposable = (function() {
      function InnerDisposable(disposable) {
        this.disposable = disposable;
        this.disposable.count++;
        this.isInnerDisposed = false;
      }
      InnerDisposable.prototype.dispose = function() {
        if (!this.disposable.isDisposed && !this.isInnerDisposed) {
          this.isInnerDisposed = true;
          this.disposable.count--;
          if (this.disposable.count === 0 && this.disposable.isPrimaryDisposed) {
            this.disposable.isDisposed = true;
            this.disposable.underlyingDisposable.dispose();
          }
        }
      };
      function RefCountDisposable(disposable) {
        this.underlyingDisposable = disposable;
        this.isDisposed = false;
        this.isPrimaryDisposed = false;
        this.count = 0;
      }
      RefCountDisposable.prototype.dispose = function() {
        if (!this.isDisposed && !this.isPrimaryDisposed) {
          this.isPrimaryDisposed = true;
          if (this.count === 0) {
            this.isDisposed = true;
            this.underlyingDisposable.dispose();
          }
        }
      };
      RefCountDisposable.prototype.getDisposable = function() {
        return this.isDisposed ? disposableEmpty : new InnerDisposable(this);
      };
      return RefCountDisposable;
    })();
    function ScheduledDisposable(scheduler, disposable) {
      this.scheduler = scheduler;
      this.disposable = disposable;
      this.isDisposed = false;
    }
    function scheduleItem(s, self) {
      if (!self.isDisposed) {
        self.isDisposed = true;
        self.disposable.dispose();
      }
    }
    ScheduledDisposable.prototype.dispose = function() {
      this.scheduler.scheduleWithState(this, scheduleItem);
    };
    var ScheduledItem = Rx.internals.ScheduledItem = function(scheduler, state, action, dueTime, comparer) {
      this.scheduler = scheduler;
      this.state = state;
      this.action = action;
      this.dueTime = dueTime;
      this.comparer = comparer || defaultSubComparer;
      this.disposable = new SingleAssignmentDisposable();
    };
    ScheduledItem.prototype.invoke = function() {
      this.disposable.setDisposable(this.invokeCore());
    };
    ScheduledItem.prototype.compareTo = function(other) {
      return this.comparer(this.dueTime, other.dueTime);
    };
    ScheduledItem.prototype.isCancelled = function() {
      return this.disposable.isDisposed;
    };
    ScheduledItem.prototype.invokeCore = function() {
      return this.action(this.scheduler, this.state);
    };
    var Scheduler = Rx.Scheduler = (function() {
      function Scheduler(now, schedule, scheduleRelative, scheduleAbsolute) {
        this.now = now;
        this._schedule = schedule;
        this._scheduleRelative = scheduleRelative;
        this._scheduleAbsolute = scheduleAbsolute;
      }
      function invokeAction(scheduler, action) {
        action();
        return disposableEmpty;
      }
      var schedulerProto = Scheduler.prototype;
      schedulerProto.schedule = function(action) {
        return this._schedule(action, invokeAction);
      };
      schedulerProto.scheduleWithState = function(state, action) {
        return this._schedule(state, action);
      };
      schedulerProto.scheduleWithRelative = function(dueTime, action) {
        return this._scheduleRelative(action, dueTime, invokeAction);
      };
      schedulerProto.scheduleWithRelativeAndState = function(state, dueTime, action) {
        return this._scheduleRelative(state, dueTime, action);
      };
      schedulerProto.scheduleWithAbsolute = function(dueTime, action) {
        return this._scheduleAbsolute(action, dueTime, invokeAction);
      };
      schedulerProto.scheduleWithAbsoluteAndState = function(state, dueTime, action) {
        return this._scheduleAbsolute(state, dueTime, action);
      };
      Scheduler.now = defaultNow;
      Scheduler.normalize = function(timeSpan) {
        timeSpan < 0 && (timeSpan = 0);
        return timeSpan;
      };
      return Scheduler;
    }());
    var normalizeTime = Scheduler.normalize;
    (function(schedulerProto) {
      function invokeRecImmediate(scheduler, pair) {
        var state = pair[0],
          action = pair[1],
          group = new CompositeDisposable();
        function recursiveAction(state1) {
          action(state1, function(state2) {
            var isAdded = false,
              isDone = false,
              d = scheduler.scheduleWithState(state2, function(scheduler1, state3) {
                if (isAdded) {
                  group.remove(d);
                } else {
                  isDone = true;
                }
                recursiveAction(state3);
                return disposableEmpty;
              });
            if (!isDone) {
              group.add(d);
              isAdded = true;
            }
          });
        }
        recursiveAction(state);
        return group;
      }
      function invokeRecDate(scheduler, pair, method) {
        var state = pair[0],
          action = pair[1],
          group = new CompositeDisposable();
        function recursiveAction(state1) {
          action(state1, function(state2, dueTime1) {
            var isAdded = false,
              isDone = false,
              d = scheduler[method](state2, dueTime1, function(scheduler1, state3) {
                if (isAdded) {
                  group.remove(d);
                } else {
                  isDone = true;
                }
                recursiveAction(state3);
                return disposableEmpty;
              });
            if (!isDone) {
              group.add(d);
              isAdded = true;
            }
          });
        }
        ;
        recursiveAction(state);
        return group;
      }
      function scheduleInnerRecursive(action, self) {
        action(function(dt) {
          self(action, dt);
        });
      }
      schedulerProto.scheduleRecursive = function(action) {
        return this.scheduleRecursiveWithState(action, function(_action, self) {
          _action(function() {
            self(_action);
          });
        });
      };
      schedulerProto.scheduleRecursiveWithState = function(state, action) {
        return this.scheduleWithState([state, action], invokeRecImmediate);
      };
      schedulerProto.scheduleRecursiveWithRelative = function(dueTime, action) {
        return this.scheduleRecursiveWithRelativeAndState(action, dueTime, scheduleInnerRecursive);
      };
      schedulerProto.scheduleRecursiveWithRelativeAndState = function(state, dueTime, action) {
        return this._scheduleRelative([state, action], dueTime, function(s, p) {
          return invokeRecDate(s, p, 'scheduleWithRelativeAndState');
        });
      };
      schedulerProto.scheduleRecursiveWithAbsolute = function(dueTime, action) {
        return this.scheduleRecursiveWithAbsoluteAndState(action, dueTime, scheduleInnerRecursive);
      };
      schedulerProto.scheduleRecursiveWithAbsoluteAndState = function(state, dueTime, action) {
        return this._scheduleAbsolute([state, action], dueTime, function(s, p) {
          return invokeRecDate(s, p, 'scheduleWithAbsoluteAndState');
        });
      };
    }(Scheduler.prototype));
    (function(schedulerProto) {
      Scheduler.prototype.schedulePeriodic = function(period, action) {
        return this.schedulePeriodicWithState(null, period, action);
      };
      Scheduler.prototype.schedulePeriodicWithState = function(state, period, action) {
        if (typeof root.setInterval === 'undefined') {
          throw new NotSupportedError();
        }
        period = normalizeTime(period);
        var s = state,
          id = root.setInterval(function() {
            s = action(s);
          }, period);
        return disposableCreate(function() {
          root.clearInterval(id);
        });
      };
    }(Scheduler.prototype));
    (function(schedulerProto) {
      schedulerProto.catchError = schedulerProto['catch'] = function(handler) {
        return new CatchScheduler(this, handler);
      };
    }(Scheduler.prototype));
    var SchedulePeriodicRecursive = Rx.internals.SchedulePeriodicRecursive = (function() {
      function tick(command, recurse) {
        recurse(0, this._period);
        try {
          this._state = this._action(this._state);
        } catch (e) {
          this._cancel.dispose();
          throw e;
        }
      }
      function SchedulePeriodicRecursive(scheduler, state, period, action) {
        this._scheduler = scheduler;
        this._state = state;
        this._period = period;
        this._action = action;
      }
      SchedulePeriodicRecursive.prototype.start = function() {
        var d = new SingleAssignmentDisposable();
        this._cancel = d;
        d.setDisposable(this._scheduler.scheduleRecursiveWithRelativeAndState(0, this._period, tick.bind(this)));
        return d;
      };
      return SchedulePeriodicRecursive;
    }());
    var immediateScheduler = Scheduler.immediate = (function() {
      function scheduleNow(state, action) {
        return action(this, state);
      }
      return new Scheduler(defaultNow, scheduleNow, notSupported, notSupported);
    }());
    var currentThreadScheduler = Scheduler.currentThread = (function() {
      var queue;
      function runTrampoline() {
        while (queue.length > 0) {
          var item = queue.dequeue();
          !item.isCancelled() && item.invoke();
        }
      }
      function scheduleNow(state, action) {
        var si = new ScheduledItem(this, state, action, this.now());
        if (!queue) {
          queue = new PriorityQueue(4);
          queue.enqueue(si);
          var result = tryCatch(runTrampoline)();
          queue = null;
          if (result === errorObj) {
            return thrower(result.e);
          }
        } else {
          queue.enqueue(si);
        }
        return si.disposable;
      }
      var currentScheduler = new Scheduler(defaultNow, scheduleNow, notSupported, notSupported);
      currentScheduler.scheduleRequired = function() {
        return !queue;
      };
      return currentScheduler;
    }());
    var scheduleMethod,
      clearMethod;
    var localTimer = (function() {
      var localSetTimeout,
        localClearTimeout = noop;
      if (!!root.WScript) {
        localSetTimeout = function(fn, time) {
          root.WScript.Sleep(time);
          fn();
        };
      } else if (!!root.setTimeout) {
        localSetTimeout = root.setTimeout;
        localClearTimeout = root.clearTimeout;
      } else {
        throw new NotSupportedError();
      }
      return {
        setTimeout: localSetTimeout,
        clearTimeout: localClearTimeout
      };
    }());
    var localSetTimeout = localTimer.setTimeout,
      localClearTimeout = localTimer.clearTimeout;
    (function() {
      var nextHandle = 1,
        tasksByHandle = {},
        currentlyRunning = false;
      clearMethod = function(handle) {
        delete tasksByHandle[handle];
      };
      function runTask(handle) {
        if (currentlyRunning) {
          localSetTimeout(function() {
            runTask(handle);
          }, 0);
        } else {
          var task = tasksByHandle[handle];
          if (task) {
            currentlyRunning = true;
            var result = tryCatch(task)();
            clearMethod(handle);
            currentlyRunning = false;
            if (result === errorObj) {
              return thrower(result.e);
            }
          }
        }
      }
      var reNative = RegExp('^' + String(toString).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/toString| for [^\]]+/g, '.*?') + '$');
      var setImmediate = typeof(setImmediate = freeGlobal && moduleExports && freeGlobal.setImmediate) == 'function' && !reNative.test(setImmediate) && setImmediate;
      function postMessageSupported() {
        if (!root.postMessage || root.importScripts) {
          return false;
        }
        var isAsync = false,
          oldHandler = root.onmessage;
        root.onmessage = function() {
          isAsync = true;
        };
        root.postMessage('', '*');
        root.onmessage = oldHandler;
        return isAsync;
      }
      if (isFunction(setImmediate)) {
        scheduleMethod = function(action) {
          var id = nextHandle++;
          tasksByHandle[id] = action;
          setImmediate(function() {
            runTask(id);
          });
          return id;
        };
      } else if (typeof process !== 'undefined' && {}.toString.call(process) === '[object process]') {
        scheduleMethod = function(action) {
          var id = nextHandle++;
          tasksByHandle[id] = action;
          process.nextTick(function() {
            runTask(id);
          });
          return id;
        };
      } else if (postMessageSupported()) {
        var MSG_PREFIX = 'ms.rx.schedule' + Math.random();
        function onGlobalPostMessage(event) {
          if (typeof event.data === 'string' && event.data.substring(0, MSG_PREFIX.length) === MSG_PREFIX) {
            runTask(event.data.substring(MSG_PREFIX.length));
          }
        }
        if (root.addEventListener) {
          root.addEventListener('message', onGlobalPostMessage, false);
        } else {
          root.attachEvent('onmessage', onGlobalPostMessage, false);
        }
        scheduleMethod = function(action) {
          var id = nextHandle++;
          tasksByHandle[id] = action;
          root.postMessage(MSG_PREFIX + currentId, '*');
          return id;
        };
      } else if (!!root.MessageChannel) {
        var channel = new root.MessageChannel();
        channel.port1.onmessage = function(e) {
          runTask(e.data);
        };
        scheduleMethod = function(action) {
          var id = nextHandle++;
          tasksByHandle[id] = action;
          channel.port2.postMessage(id);
          return id;
        };
      } else if ('document' in root && 'onreadystatechange' in root.document.createElement('script')) {
        scheduleMethod = function(action) {
          var scriptElement = root.document.createElement('script');
          var id = nextHandle++;
          tasksByHandle[id] = action;
          scriptElement.onreadystatechange = function() {
            runTask(id);
            scriptElement.onreadystatechange = null;
            scriptElement.parentNode.removeChild(scriptElement);
            scriptElement = null;
          };
          root.document.documentElement.appendChild(scriptElement);
          return id;
        };
      } else {
        scheduleMethod = function(action) {
          var id = nextHandle++;
          tasksByHandle[id] = action;
          localSetTimeout(function() {
            runTask(id);
          }, 0);
          return id;
        };
      }
    }());
    var timeoutScheduler = Scheduler.timeout = Scheduler.default = (function() {
      function scheduleNow(state, action) {
        var scheduler = this,
          disposable = new SingleAssignmentDisposable();
        var id = scheduleMethod(function() {
          if (!disposable.isDisposed) {
            disposable.setDisposable(action(scheduler, state));
          }
        });
        return new CompositeDisposable(disposable, disposableCreate(function() {
          clearMethod(id);
        }));
      }
      function scheduleRelative(state, dueTime, action) {
        var scheduler = this,
          dt = Scheduler.normalize(dueTime);
        if (dt === 0) {
          return scheduler.scheduleWithState(state, action);
        }
        var disposable = new SingleAssignmentDisposable();
        var id = localSetTimeout(function() {
          if (!disposable.isDisposed) {
            disposable.setDisposable(action(scheduler, state));
          }
        }, dt);
        return new CompositeDisposable(disposable, disposableCreate(function() {
          localClearTimeout(id);
        }));
      }
      function scheduleAbsolute(state, dueTime, action) {
        return this.scheduleWithRelativeAndState(state, dueTime - this.now(), action);
      }
      return new Scheduler(defaultNow, scheduleNow, scheduleRelative, scheduleAbsolute);
    })();
    var CatchScheduler = (function(__super__) {
      function scheduleNow(state, action) {
        return this._scheduler.scheduleWithState(state, this._wrap(action));
      }
      function scheduleRelative(state, dueTime, action) {
        return this._scheduler.scheduleWithRelativeAndState(state, dueTime, this._wrap(action));
      }
      function scheduleAbsolute(state, dueTime, action) {
        return this._scheduler.scheduleWithAbsoluteAndState(state, dueTime, this._wrap(action));
      }
      inherits(CatchScheduler, __super__);
      function CatchScheduler(scheduler, handler) {
        this._scheduler = scheduler;
        this._handler = handler;
        this._recursiveOriginal = null;
        this._recursiveWrapper = null;
        __super__.call(this, this._scheduler.now.bind(this._scheduler), scheduleNow, scheduleRelative, scheduleAbsolute);
      }
      CatchScheduler.prototype._clone = function(scheduler) {
        return new CatchScheduler(scheduler, this._handler);
      };
      CatchScheduler.prototype._wrap = function(action) {
        var parent = this;
        return function(self, state) {
          try {
            return action(parent._getRecursiveWrapper(self), state);
          } catch (e) {
            if (!parent._handler(e)) {
              throw e;
            }
            return disposableEmpty;
          }
        };
      };
      CatchScheduler.prototype._getRecursiveWrapper = function(scheduler) {
        if (this._recursiveOriginal !== scheduler) {
          this._recursiveOriginal = scheduler;
          var wrapper = this._clone(scheduler);
          wrapper._recursiveOriginal = scheduler;
          wrapper._recursiveWrapper = wrapper;
          this._recursiveWrapper = wrapper;
        }
        return this._recursiveWrapper;
      };
      CatchScheduler.prototype.schedulePeriodicWithState = function(state, period, action) {
        var self = this,
          failed = false,
          d = new SingleAssignmentDisposable();
        d.setDisposable(this._scheduler.schedulePeriodicWithState(state, period, function(state1) {
          if (failed) {
            return null;
          }
          try {
            return action(state1);
          } catch (e) {
            failed = true;
            if (!self._handler(e)) {
              throw e;
            }
            d.dispose();
            return null;
          }
        }));
        return d;
      };
      return CatchScheduler;
    }(Scheduler));
    var Notification = Rx.Notification = (function() {
      function Notification(kind, value, exception, accept, acceptObservable, toString) {
        this.kind = kind;
        this.value = value;
        this.exception = exception;
        this._accept = accept;
        this._acceptObservable = acceptObservable;
        this.toString = toString;
      }
      Notification.prototype.accept = function(observerOrOnNext, onError, onCompleted) {
        return observerOrOnNext && typeof observerOrOnNext === 'object' ? this._acceptObservable(observerOrOnNext) : this._accept(observerOrOnNext, onError, onCompleted);
      };
      Notification.prototype.toObservable = function(scheduler) {
        var self = this;
        isScheduler(scheduler) || (scheduler = immediateScheduler);
        return new AnonymousObservable(function(observer) {
          return scheduler.scheduleWithState(self, function(_, notification) {
            notification._acceptObservable(observer);
            notification.kind === 'N' && observer.onCompleted();
          });
        });
      };
      return Notification;
    })();
    var notificationCreateOnNext = Notification.createOnNext = (function() {
      function _accept(onNext) {
        return onNext(this.value);
      }
      function _acceptObservable(observer) {
        return observer.onNext(this.value);
      }
      function toString() {
        return 'OnNext(' + this.value + ')';
      }
      return function(value) {
        return new Notification('N', value, null, _accept, _acceptObservable, toString);
      };
    }());
    var notificationCreateOnError = Notification.createOnError = (function() {
      function _accept(onNext, onError) {
        return onError(this.exception);
      }
      function _acceptObservable(observer) {
        return observer.onError(this.exception);
      }
      function toString() {
        return 'OnError(' + this.exception + ')';
      }
      return function(e) {
        return new Notification('E', null, e, _accept, _acceptObservable, toString);
      };
    }());
    var notificationCreateOnCompleted = Notification.createOnCompleted = (function() {
      function _accept(onNext, onError, onCompleted) {
        return onCompleted();
      }
      function _acceptObservable(observer) {
        return observer.onCompleted();
      }
      function toString() {
        return 'OnCompleted()';
      }
      return function() {
        return new Notification('C', null, null, _accept, _acceptObservable, toString);
      };
    }());
    var Enumerator = Rx.internals.Enumerator = function(next) {
      this._next = next;
    };
    Enumerator.prototype.next = function() {
      return this._next();
    };
    Enumerator.prototype[$iterator$] = function() {
      return this;
    };
    var Enumerable = Rx.internals.Enumerable = function(iterator) {
      this._iterator = iterator;
    };
    Enumerable.prototype[$iterator$] = function() {
      return this._iterator();
    };
    Enumerable.prototype.concat = function() {
      var sources = this;
      return new AnonymousObservable(function(o) {
        var e = sources[$iterator$]();
        var isDisposed,
          subscription = new SerialDisposable();
        var cancelable = immediateScheduler.scheduleRecursive(function(self) {
          if (isDisposed) {
            return ;
          }
          try {
            var currentItem = e.next();
          } catch (ex) {
            return o.onError(ex);
          }
          if (currentItem.done) {
            return o.onCompleted();
          }
          var currentValue = currentItem.value;
          isPromise(currentValue) && (currentValue = observableFromPromise(currentValue));
          var d = new SingleAssignmentDisposable();
          subscription.setDisposable(d);
          d.setDisposable(currentValue.subscribe(function(x) {
            o.onNext(x);
          }, function(err) {
            o.onError(err);
          }, self));
        });
        return new CompositeDisposable(subscription, cancelable, disposableCreate(function() {
          isDisposed = true;
        }));
      });
    };
    Enumerable.prototype.catchError = function() {
      var sources = this;
      return new AnonymousObservable(function(o) {
        var e = sources[$iterator$]();
        var isDisposed,
          subscription = new SerialDisposable();
        var cancelable = immediateScheduler.scheduleRecursiveWithState(null, function(lastException, self) {
          if (isDisposed) {
            return ;
          }
          try {
            var currentItem = e.next();
          } catch (ex) {
            return observer.onError(ex);
          }
          if (currentItem.done) {
            if (lastException !== null) {
              o.onError(lastException);
            } else {
              o.onCompleted();
            }
            return ;
          }
          var currentValue = currentItem.value;
          isPromise(currentValue) && (currentValue = observableFromPromise(currentValue));
          var d = new SingleAssignmentDisposable();
          subscription.setDisposable(d);
          d.setDisposable(currentValue.subscribe(function(x) {
            o.onNext(x);
          }, self, function() {
            o.onCompleted();
          }));
        });
        return new CompositeDisposable(subscription, cancelable, disposableCreate(function() {
          isDisposed = true;
        }));
      });
    };
    Enumerable.prototype.catchErrorWhen = function(notificationHandler) {
      var sources = this;
      return new AnonymousObservable(function(o) {
        var exceptions = new Subject(),
          notifier = new Subject(),
          handled = notificationHandler(exceptions),
          notificationDisposable = handled.subscribe(notifier);
        var e = sources[$iterator$]();
        var isDisposed,
          lastException,
          subscription = new SerialDisposable();
        var cancelable = immediateScheduler.scheduleRecursive(function(self) {
          if (isDisposed) {
            return ;
          }
          try {
            var currentItem = e.next();
          } catch (ex) {
            return o.onError(ex);
          }
          if (currentItem.done) {
            if (lastException) {
              o.onError(lastException);
            } else {
              o.onCompleted();
            }
            return ;
          }
          var currentValue = currentItem.value;
          isPromise(currentValue) && (currentValue = observableFromPromise(currentValue));
          var outer = new SingleAssignmentDisposable();
          var inner = new SingleAssignmentDisposable();
          subscription.setDisposable(new CompositeDisposable(inner, outer));
          outer.setDisposable(currentValue.subscribe(function(x) {
            o.onNext(x);
          }, function(exn) {
            inner.setDisposable(notifier.subscribe(self, function(ex) {
              o.onError(ex);
            }, function() {
              o.onCompleted();
            }));
            exceptions.onNext(exn);
          }, function() {
            o.onCompleted();
          }));
        });
        return new CompositeDisposable(notificationDisposable, subscription, cancelable, disposableCreate(function() {
          isDisposed = true;
        }));
      });
    };
    var enumerableRepeat = Enumerable.repeat = function(value, repeatCount) {
      if (repeatCount == null) {
        repeatCount = -1;
      }
      return new Enumerable(function() {
        var left = repeatCount;
        return new Enumerator(function() {
          if (left === 0) {
            return doneEnumerator;
          }
          if (left > 0) {
            left--;
          }
          return {
            done: false,
            value: value
          };
        });
      });
    };
    var enumerableOf = Enumerable.of = function(source, selector, thisArg) {
      if (selector) {
        var selectorFn = bindCallback(selector, thisArg, 3);
      }
      return new Enumerable(function() {
        var index = -1;
        return new Enumerator(function() {
          return ++index < source.length ? {
            done: false,
            value: !selector ? source[index] : selectorFn(source[index], index, source)
          } : doneEnumerator;
        });
      });
    };
    var Observer = Rx.Observer = function() {};
    Observer.prototype.toNotifier = function() {
      var observer = this;
      return function(n) {
        return n.accept(observer);
      };
    };
    Observer.prototype.asObserver = function() {
      return new AnonymousObserver(this.onNext.bind(this), this.onError.bind(this), this.onCompleted.bind(this));
    };
    Observer.prototype.checked = function() {
      return new CheckedObserver(this);
    };
    var observerCreate = Observer.create = function(onNext, onError, onCompleted) {
      onNext || (onNext = noop);
      onError || (onError = defaultError);
      onCompleted || (onCompleted = noop);
      return new AnonymousObserver(onNext, onError, onCompleted);
    };
    Observer.fromNotifier = function(handler, thisArg) {
      return new AnonymousObserver(function(x) {
        return handler.call(thisArg, notificationCreateOnNext(x));
      }, function(e) {
        return handler.call(thisArg, notificationCreateOnError(e));
      }, function() {
        return handler.call(thisArg, notificationCreateOnCompleted());
      });
    };
    Observer.prototype.notifyOn = function(scheduler) {
      return new ObserveOnObserver(scheduler, this);
    };
    Observer.prototype.makeSafe = function(disposable) {
      return new AnonymousSafeObserver(this._onNext, this._onError, this._onCompleted, disposable);
    };
    var AbstractObserver = Rx.internals.AbstractObserver = (function(__super__) {
      inherits(AbstractObserver, __super__);
      function AbstractObserver() {
        this.isStopped = false;
        __super__.call(this);
      }
      AbstractObserver.prototype.next = notImplemented;
      AbstractObserver.prototype.error = notImplemented;
      AbstractObserver.prototype.completed = notImplemented;
      AbstractObserver.prototype.onNext = function(value) {
        if (!this.isStopped) {
          this.next(value);
        }
      };
      AbstractObserver.prototype.onError = function(error) {
        if (!this.isStopped) {
          this.isStopped = true;
          this.error(error);
        }
      };
      AbstractObserver.prototype.onCompleted = function() {
        if (!this.isStopped) {
          this.isStopped = true;
          this.completed();
        }
      };
      AbstractObserver.prototype.dispose = function() {
        this.isStopped = true;
      };
      AbstractObserver.prototype.fail = function(e) {
        if (!this.isStopped) {
          this.isStopped = true;
          this.error(e);
          return true;
        }
        return false;
      };
      return AbstractObserver;
    }(Observer));
    var AnonymousObserver = Rx.AnonymousObserver = (function(__super__) {
      inherits(AnonymousObserver, __super__);
      function AnonymousObserver(onNext, onError, onCompleted) {
        __super__.call(this);
        this._onNext = onNext;
        this._onError = onError;
        this._onCompleted = onCompleted;
      }
      AnonymousObserver.prototype.next = function(value) {
        this._onNext(value);
      };
      AnonymousObserver.prototype.error = function(error) {
        this._onError(error);
      };
      AnonymousObserver.prototype.completed = function() {
        this._onCompleted();
      };
      return AnonymousObserver;
    }(AbstractObserver));
    var CheckedObserver = (function(__super__) {
      inherits(CheckedObserver, __super__);
      function CheckedObserver(observer) {
        __super__.call(this);
        this._observer = observer;
        this._state = 0;
      }
      var CheckedObserverPrototype = CheckedObserver.prototype;
      CheckedObserverPrototype.onNext = function(value) {
        this.checkAccess();
        var res = tryCatch(this._observer.onNext).call(this._observer, value);
        this._state = 0;
        res === errorObj && thrower(res.e);
      };
      CheckedObserverPrototype.onError = function(err) {
        this.checkAccess();
        var res = tryCatch(this._observer.onError).call(this._observer, err);
        this._state = 2;
        res === errorObj && thrower(res.e);
      };
      CheckedObserverPrototype.onCompleted = function() {
        this.checkAccess();
        var res = tryCatch(this._observer.onCompleted).call(this._observer);
        this._state = 2;
        res === errorObj && thrower(res.e);
      };
      CheckedObserverPrototype.checkAccess = function() {
        if (this._state === 1) {
          throw new Error('Re-entrancy detected');
        }
        if (this._state === 2) {
          throw new Error('Observer completed');
        }
        if (this._state === 0) {
          this._state = 1;
        }
      };
      return CheckedObserver;
    }(Observer));
    var ScheduledObserver = Rx.internals.ScheduledObserver = (function(__super__) {
      inherits(ScheduledObserver, __super__);
      function ScheduledObserver(scheduler, observer) {
        __super__.call(this);
        this.scheduler = scheduler;
        this.observer = observer;
        this.isAcquired = false;
        this.hasFaulted = false;
        this.queue = [];
        this.disposable = new SerialDisposable();
      }
      ScheduledObserver.prototype.next = function(value) {
        var self = this;
        this.queue.push(function() {
          self.observer.onNext(value);
        });
      };
      ScheduledObserver.prototype.error = function(e) {
        var self = this;
        this.queue.push(function() {
          self.observer.onError(e);
        });
      };
      ScheduledObserver.prototype.completed = function() {
        var self = this;
        this.queue.push(function() {
          self.observer.onCompleted();
        });
      };
      ScheduledObserver.prototype.ensureActive = function() {
        var isOwner = false,
          parent = this;
        if (!this.hasFaulted && this.queue.length > 0) {
          isOwner = !this.isAcquired;
          this.isAcquired = true;
        }
        if (isOwner) {
          this.disposable.setDisposable(this.scheduler.scheduleRecursive(function(self) {
            var work;
            if (parent.queue.length > 0) {
              work = parent.queue.shift();
            } else {
              parent.isAcquired = false;
              return ;
            }
            try {
              work();
            } catch (ex) {
              parent.queue = [];
              parent.hasFaulted = true;
              throw ex;
            }
            self();
          }));
        }
      };
      ScheduledObserver.prototype.dispose = function() {
        __super__.prototype.dispose.call(this);
        this.disposable.dispose();
      };
      return ScheduledObserver;
    }(AbstractObserver));
    var ObserveOnObserver = (function(__super__) {
      inherits(ObserveOnObserver, __super__);
      function ObserveOnObserver(scheduler, observer, cancel) {
        __super__.call(this, scheduler, observer);
        this._cancel = cancel;
      }
      ObserveOnObserver.prototype.next = function(value) {
        __super__.prototype.next.call(this, value);
        this.ensureActive();
      };
      ObserveOnObserver.prototype.error = function(e) {
        __super__.prototype.error.call(this, e);
        this.ensureActive();
      };
      ObserveOnObserver.prototype.completed = function() {
        __super__.prototype.completed.call(this);
        this.ensureActive();
      };
      ObserveOnObserver.prototype.dispose = function() {
        __super__.prototype.dispose.call(this);
        this._cancel && this._cancel.dispose();
        this._cancel = null;
      };
      return ObserveOnObserver;
    })(ScheduledObserver);
    var observableProto;
    var Observable = Rx.Observable = (function() {
      function Observable(subscribe) {
        if (Rx.config.longStackSupport && hasStacks) {
          try {
            throw new Error();
          } catch (e) {
            this.stack = e.stack.substring(e.stack.indexOf("\n") + 1);
          }
          var self = this;
          this._subscribe = function(observer) {
            var oldOnError = observer.onError.bind(observer);
            observer.onError = function(err) {
              makeStackTraceLong(err, self);
              oldOnError(err);
            };
            return subscribe.call(self, observer);
          };
        } else {
          this._subscribe = subscribe;
        }
      }
      observableProto = Observable.prototype;
      observableProto.subscribe = observableProto.forEach = function(observerOrOnNext, onError, onCompleted) {
        return this._subscribe(typeof observerOrOnNext === 'object' ? observerOrOnNext : observerCreate(observerOrOnNext, onError, onCompleted));
      };
      observableProto.subscribeOnNext = function(onNext, thisArg) {
        return this._subscribe(observerCreate(typeof thisArg !== 'undefined' ? function(x) {
          onNext.call(thisArg, x);
        } : onNext));
      };
      observableProto.subscribeOnError = function(onError, thisArg) {
        return this._subscribe(observerCreate(null, typeof thisArg !== 'undefined' ? function(e) {
          onError.call(thisArg, e);
        } : onError));
      };
      observableProto.subscribeOnCompleted = function(onCompleted, thisArg) {
        return this._subscribe(observerCreate(null, null, typeof thisArg !== 'undefined' ? function() {
          onCompleted.call(thisArg);
        } : onCompleted));
      };
      return Observable;
    })();
    var ObservableBase = Rx.ObservableBase = (function(__super__) {
      inherits(ObservableBase, __super__);
      function fixSubscriber(subscriber) {
        return subscriber && isFunction(subscriber.dispose) ? subscriber : isFunction(subscriber) ? disposableCreate(subscriber) : disposableEmpty;
      }
      function setDisposable(s, state) {
        var ado = state[0],
          self = state[1];
        var sub = tryCatch(self.subscribeCore).call(self, ado);
        if (sub === errorObj) {
          if (!ado.fail(errorObj.e)) {
            return thrower(errorObj.e);
          }
        }
        ado.setDisposable(fixSubscriber(sub));
      }
      function subscribe(observer) {
        var ado = new AutoDetachObserver(observer),
          state = [ado, this];
        if (currentThreadScheduler.scheduleRequired()) {
          currentThreadScheduler.scheduleWithState(state, setDisposable);
        } else {
          setDisposable(null, state);
        }
        return ado;
      }
      function ObservableBase() {
        __super__.call(this, subscribe);
      }
      ObservableBase.prototype.subscribeCore = notImplemented;
      return ObservableBase;
    }(Observable));
    observableProto.observeOn = function(scheduler) {
      var source = this;
      return new AnonymousObservable(function(observer) {
        return source.subscribe(new ObserveOnObserver(scheduler, observer));
      }, source);
    };
    observableProto.subscribeOn = function(scheduler) {
      var source = this;
      return new AnonymousObservable(function(observer) {
        var m = new SingleAssignmentDisposable(),
          d = new SerialDisposable();
        d.setDisposable(m);
        m.setDisposable(scheduler.schedule(function() {
          d.setDisposable(new ScheduledDisposable(scheduler, source.subscribe(observer)));
        }));
        return d;
      }, source);
    };
    var observableFromPromise = Observable.fromPromise = function(promise) {
      return observableDefer(function() {
        var subject = new Rx.AsyncSubject();
        promise.then(function(value) {
          subject.onNext(value);
          subject.onCompleted();
        }, subject.onError.bind(subject));
        return subject;
      });
    };
    observableProto.toPromise = function(promiseCtor) {
      promiseCtor || (promiseCtor = Rx.config.Promise);
      if (!promiseCtor) {
        throw new NotSupportedError('Promise type not provided nor in Rx.config.Promise');
      }
      var source = this;
      return new promiseCtor(function(resolve, reject) {
        var value,
          hasValue = false;
        source.subscribe(function(v) {
          value = v;
          hasValue = true;
        }, reject, function() {
          hasValue && resolve(value);
        });
      });
    };
    var ToArrayObservable = (function(__super__) {
      inherits(ToArrayObservable, __super__);
      function ToArrayObservable(source) {
        this.source = source;
        __super__.call(this);
      }
      ToArrayObservable.prototype.subscribeCore = function(observer) {
        return this.source.subscribe(new ToArrayObserver(observer));
      };
      return ToArrayObservable;
    }(ObservableBase));
    function ToArrayObserver(observer) {
      this.observer = observer;
      this.a = [];
      this.isStopped = false;
    }
    ToArrayObserver.prototype.onNext = function(x) {
      if (!this.isStopped) {
        this.a.push(x);
      }
    };
    ToArrayObserver.prototype.onError = function(e) {
      if (!this.isStopped) {
        this.isStopped = true;
        this.observer.onError(e);
      }
    };
    ToArrayObserver.prototype.onCompleted = function() {
      if (!this.isStopped) {
        this.isStopped = true;
        this.observer.onNext(this.a);
        this.observer.onCompleted();
      }
    };
    ToArrayObserver.prototype.dispose = function() {
      this.isStopped = true;
    };
    ToArrayObserver.prototype.fail = function(e) {
      if (!this.isStopped) {
        this.isStopped = true;
        this.observer.onError(e);
        return true;
      }
      return false;
    };
    observableProto.toArray = function() {
      return new ToArrayObservable(this);
    };
    Observable.create = Observable.createWithDisposable = function(subscribe, parent) {
      return new AnonymousObservable(subscribe, parent);
    };
    var observableDefer = Observable.defer = function(observableFactory) {
      return new AnonymousObservable(function(observer) {
        var result;
        try {
          result = observableFactory();
        } catch (e) {
          return observableThrow(e).subscribe(observer);
        }
        isPromise(result) && (result = observableFromPromise(result));
        return result.subscribe(observer);
      });
    };
    var observableEmpty = Observable.empty = function(scheduler) {
      isScheduler(scheduler) || (scheduler = immediateScheduler);
      return new AnonymousObservable(function(observer) {
        return scheduler.scheduleWithState(null, function() {
          observer.onCompleted();
        });
      });
    };
    var FromObservable = (function(__super__) {
      inherits(FromObservable, __super__);
      function FromObservable(iterable, mapper, scheduler) {
        this.iterable = iterable;
        this.mapper = mapper;
        this.scheduler = scheduler;
        __super__.call(this);
      }
      FromObservable.prototype.subscribeCore = function(observer) {
        var sink = new FromSink(observer, this);
        return sink.run();
      };
      return FromObservable;
    }(ObservableBase));
    var FromSink = (function() {
      function FromSink(observer, parent) {
        this.observer = observer;
        this.parent = parent;
      }
      FromSink.prototype.run = function() {
        var list = Object(this.parent.iterable),
          it = getIterable(list),
          observer = this.observer,
          mapper = this.parent.mapper;
        function loopRecursive(i, recurse) {
          try {
            var next = it.next();
          } catch (e) {
            return observer.onError(e);
          }
          if (next.done) {
            return observer.onCompleted();
          }
          var result = next.value;
          if (mapper) {
            try {
              result = mapper(result, i);
            } catch (e) {
              return observer.onError(e);
            }
          }
          observer.onNext(result);
          recurse(i + 1);
        }
        return this.parent.scheduler.scheduleRecursiveWithState(0, loopRecursive);
      };
      return FromSink;
    }());
    var maxSafeInteger = Math.pow(2, 53) - 1;
    function StringIterable(str) {
      this._s = s;
    }
    StringIterable.prototype[$iterator$] = function() {
      return new StringIterator(this._s);
    };
    function StringIterator(str) {
      this._s = s;
      this._l = s.length;
      this._i = 0;
    }
    StringIterator.prototype[$iterator$] = function() {
      return this;
    };
    StringIterator.prototype.next = function() {
      return this._i < this._l ? {
        done: false,
        value: this._s.charAt(this._i++)
      } : doneEnumerator;
    };
    function ArrayIterable(a) {
      this._a = a;
    }
    ArrayIterable.prototype[$iterator$] = function() {
      return new ArrayIterator(this._a);
    };
    function ArrayIterator(a) {
      this._a = a;
      this._l = toLength(a);
      this._i = 0;
    }
    ArrayIterator.prototype[$iterator$] = function() {
      return this;
    };
    ArrayIterator.prototype.next = function() {
      return this._i < this._l ? {
        done: false,
        value: this._a[this._i++]
      } : doneEnumerator;
    };
    function numberIsFinite(value) {
      return typeof value === 'number' && root.isFinite(value);
    }
    function isNan(n) {
      return n !== n;
    }
    function getIterable(o) {
      var i = o[$iterator$],
        it;
      if (!i && typeof o === 'string') {
        it = new StringIterable(o);
        return it[$iterator$]();
      }
      if (!i && o.length !== undefined) {
        it = new ArrayIterable(o);
        return it[$iterator$]();
      }
      if (!i) {
        throw new TypeError('Object is not iterable');
      }
      return o[$iterator$]();
    }
    function sign(value) {
      var number = +value;
      if (number === 0) {
        return number;
      }
      if (isNaN(number)) {
        return number;
      }
      return number < 0 ? -1 : 1;
    }
    function toLength(o) {
      var len = +o.length;
      if (isNaN(len)) {
        return 0;
      }
      if (len === 0 || !numberIsFinite(len)) {
        return len;
      }
      len = sign(len) * Math.floor(Math.abs(len));
      if (len <= 0) {
        return 0;
      }
      if (len > maxSafeInteger) {
        return maxSafeInteger;
      }
      return len;
    }
    var observableFrom = Observable.from = function(iterable, mapFn, thisArg, scheduler) {
      if (iterable == null) {
        throw new Error('iterable cannot be null.');
      }
      if (mapFn && !isFunction(mapFn)) {
        throw new Error('mapFn when provided must be a function');
      }
      if (mapFn) {
        var mapper = bindCallback(mapFn, thisArg, 2);
      }
      isScheduler(scheduler) || (scheduler = currentThreadScheduler);
      return new FromObservable(iterable, mapper, scheduler);
    };
    var FromArrayObservable = (function(__super__) {
      inherits(FromArrayObservable, __super__);
      function FromArrayObservable(args, scheduler) {
        this.args = args;
        this.scheduler = scheduler;
        __super__.call(this);
      }
      FromArrayObservable.prototype.subscribeCore = function(observer) {
        var sink = new FromArraySink(observer, this);
        return sink.run();
      };
      return FromArrayObservable;
    }(ObservableBase));
    function FromArraySink(observer, parent) {
      this.observer = observer;
      this.parent = parent;
    }
    FromArraySink.prototype.run = function() {
      var observer = this.observer,
        args = this.parent.args,
        len = args.length;
      function loopRecursive(i, recurse) {
        if (i < len) {
          observer.onNext(args[i]);
          recurse(i + 1);
        } else {
          observer.onCompleted();
        }
      }
      return this.parent.scheduler.scheduleRecursiveWithState(0, loopRecursive);
    };
    var observableFromArray = Observable.fromArray = function(array, scheduler) {
      isScheduler(scheduler) || (scheduler = currentThreadScheduler);
      return new FromArrayObservable(array, scheduler);
    };
    Observable.generate = function(initialState, condition, iterate, resultSelector, scheduler) {
      isScheduler(scheduler) || (scheduler = currentThreadScheduler);
      return new AnonymousObservable(function(o) {
        var first = true;
        return scheduler.scheduleRecursiveWithState(initialState, function(state, self) {
          var hasResult,
            result;
          try {
            if (first) {
              first = false;
            } else {
              state = iterate(state);
            }
            hasResult = condition(state);
            hasResult && (result = resultSelector(state));
          } catch (e) {
            return o.onError(e);
          }
          if (hasResult) {
            o.onNext(result);
            self(state);
          } else {
            o.onCompleted();
          }
        });
      });
    };
    function observableOf(scheduler, array) {
      isScheduler(scheduler) || (scheduler = currentThreadScheduler);
      return new FromArrayObservable(array, scheduler);
    }
    Observable.of = function() {
      var len = arguments.length,
        args = new Array(len);
      for (var i = 0; i < len; i++) {
        args[i] = arguments[i];
      }
      return new FromArrayObservable(args, currentThreadScheduler);
    };
    Observable.ofWithScheduler = function(scheduler) {
      var len = arguments.length,
        args = new Array(len - 1);
      for (var i = 1; i < len; i++) {
        args[i - 1] = arguments[i];
      }
      return new FromArrayObservable(args, scheduler);
    };
    Observable.ofArrayChanges = function(array) {
      if (!Array.isArray(array)) {
        throw new TypeError('Array.observe only accepts arrays.');
      }
      if (typeof Array.observe !== 'function' && typeof Array.unobserve !== 'function') {
        throw new TypeError('Array.observe is not supported on your platform');
      }
      return new AnonymousObservable(function(observer) {
        function observerFn(changes) {
          for (var i = 0,
                 len = changes.length; i < len; i++) {
            observer.onNext(changes[i]);
          }
        }
        Array.observe(array, observerFn);
        return function() {
          Array.unobserve(array, observerFn);
        };
      });
    };
    Observable.ofObjectChanges = function(obj) {
      if (obj == null) {
        throw new TypeError('object must not be null or undefined.');
      }
      if (typeof Object.observe !== 'function' && typeof Object.unobserve !== 'function') {
        throw new TypeError('Array.observe is not supported on your platform');
      }
      return new AnonymousObservable(function(observer) {
        function observerFn(changes) {
          for (var i = 0,
                 len = changes.length; i < len; i++) {
            observer.onNext(changes[i]);
          }
        }
        Object.observe(obj, observerFn);
        return function() {
          Object.unobserve(obj, observerFn);
        };
      });
    };
    var observableNever = Observable.never = function() {
      return new AnonymousObservable(function() {
        return disposableEmpty;
      });
    };
    Observable.pairs = function(obj, scheduler) {
      scheduler || (scheduler = Rx.Scheduler.currentThread);
      return new AnonymousObservable(function(observer) {
        var keys = Object.keys(obj),
          len = keys.length;
        return scheduler.scheduleRecursiveWithState(0, function(idx, self) {
          if (idx < len) {
            var key = keys[idx];
            observer.onNext([key, obj[key]]);
            self(idx + 1);
          } else {
            observer.onCompleted();
          }
        });
      });
    };
    var RangeObservable = (function(__super__) {
      inherits(RangeObservable, __super__);
      function RangeObservable(start, count, scheduler) {
        this.start = start;
        this.count = count;
        this.scheduler = scheduler;
        __super__.call(this);
      }
      RangeObservable.prototype.subscribeCore = function(observer) {
        var sink = new RangeSink(observer, this);
        return sink.run();
      };
      return RangeObservable;
    }(ObservableBase));
    var RangeSink = (function() {
      function RangeSink(observer, parent) {
        this.observer = observer;
        this.parent = parent;
      }
      RangeSink.prototype.run = function() {
        var start = this.parent.start,
          count = this.parent.count,
          observer = this.observer;
        function loopRecursive(i, recurse) {
          if (i < count) {
            observer.onNext(start + i);
            recurse(i + 1);
          } else {
            observer.onCompleted();
          }
        }
        return this.parent.scheduler.scheduleRecursiveWithState(0, loopRecursive);
      };
      return RangeSink;
    }());
    Observable.range = function(start, count, scheduler) {
      isScheduler(scheduler) || (scheduler = currentThreadScheduler);
      return new RangeObservable(start, count, scheduler);
    };
    Observable.repeat = function(value, repeatCount, scheduler) {
      isScheduler(scheduler) || (scheduler = currentThreadScheduler);
      return observableReturn(value, scheduler).repeat(repeatCount == null ? -1 : repeatCount);
    };
    var observableReturn = Observable['return'] = Observable.just = Observable.returnValue = function(value, scheduler) {
      isScheduler(scheduler) || (scheduler = immediateScheduler);
      return new AnonymousObservable(function(o) {
        return scheduler.scheduleWithState(value, function(_, v) {
          o.onNext(v);
          o.onCompleted();
        });
      });
    };
    var observableThrow = Observable['throw'] = Observable.throwError = function(error, scheduler) {
      isScheduler(scheduler) || (scheduler = immediateScheduler);
      return new AnonymousObservable(function(observer) {
        return scheduler.schedule(function() {
          observer.onError(error);
        });
      });
    };
    Observable.throwException = function() {
      return Observable.throwError.apply(null, arguments);
    };
    Observable.using = function(resourceFactory, observableFactory) {
      return new AnonymousObservable(function(observer) {
        var disposable = disposableEmpty,
          resource,
          source;
        try {
          resource = resourceFactory();
          resource && (disposable = resource);
          source = observableFactory(resource);
        } catch (exception) {
          return new CompositeDisposable(observableThrow(exception).subscribe(observer), disposable);
        }
        return new CompositeDisposable(source.subscribe(observer), disposable);
      });
    };
    observableProto.amb = function(rightSource) {
      var leftSource = this;
      return new AnonymousObservable(function(observer) {
        var choice,
          leftChoice = 'L',
          rightChoice = 'R',
          leftSubscription = new SingleAssignmentDisposable(),
          rightSubscription = new SingleAssignmentDisposable();
        isPromise(rightSource) && (rightSource = observableFromPromise(rightSource));
        function choiceL() {
          if (!choice) {
            choice = leftChoice;
            rightSubscription.dispose();
          }
        }
        function choiceR() {
          if (!choice) {
            choice = rightChoice;
            leftSubscription.dispose();
          }
        }
        leftSubscription.setDisposable(leftSource.subscribe(function(left) {
          choiceL();
          if (choice === leftChoice) {
            observer.onNext(left);
          }
        }, function(err) {
          choiceL();
          if (choice === leftChoice) {
            observer.onError(err);
          }
        }, function() {
          choiceL();
          if (choice === leftChoice) {
            observer.onCompleted();
          }
        }));
        rightSubscription.setDisposable(rightSource.subscribe(function(right) {
          choiceR();
          if (choice === rightChoice) {
            observer.onNext(right);
          }
        }, function(err) {
          choiceR();
          if (choice === rightChoice) {
            observer.onError(err);
          }
        }, function() {
          choiceR();
          if (choice === rightChoice) {
            observer.onCompleted();
          }
        }));
        return new CompositeDisposable(leftSubscription, rightSubscription);
      });
    };
    Observable.amb = function() {
      var acc = observableNever(),
        items = [];
      if (Array.isArray(arguments[0])) {
        items = arguments[0];
      } else {
        for (var i = 0,
               len = arguments.length; i < len; i++) {
          items.push(arguments[i]);
        }
      }
      function func(previous, current) {
        return previous.amb(current);
      }
      for (var i = 0,
             len = items.length; i < len; i++) {
        acc = func(acc, items[i]);
      }
      return acc;
    };
    function observableCatchHandler(source, handler) {
      return new AnonymousObservable(function(o) {
        var d1 = new SingleAssignmentDisposable(),
          subscription = new SerialDisposable();
        subscription.setDisposable(d1);
        d1.setDisposable(source.subscribe(function(x) {
          o.onNext(x);
        }, function(e) {
          try {
            var result = handler(e);
          } catch (ex) {
            return o.onError(ex);
          }
          isPromise(result) && (result = observableFromPromise(result));
          var d = new SingleAssignmentDisposable();
          subscription.setDisposable(d);
          d.setDisposable(result.subscribe(o));
        }, function(x) {
          o.onCompleted(x);
        }));
        return subscription;
      }, source);
    }
    observableProto['catch'] = observableProto.catchError = observableProto.catchException = function(handlerOrSecond) {
      return typeof handlerOrSecond === 'function' ? observableCatchHandler(this, handlerOrSecond) : observableCatch([this, handlerOrSecond]);
    };
    var observableCatch = Observable.catchError = Observable['catch'] = Observable.catchException = function() {
      var items = [];
      if (Array.isArray(arguments[0])) {
        items = arguments[0];
      } else {
        for (var i = 0,
               len = arguments.length; i < len; i++) {
          items.push(arguments[i]);
        }
      }
      return enumerableOf(items).catchError();
    };
    observableProto.combineLatest = function() {
      var len = arguments.length,
        args = new Array(len);
      for (var i = 0; i < len; i++) {
        args[i] = arguments[i];
      }
      if (Array.isArray(args[0])) {
        args[0].unshift(this);
      } else {
        args.unshift(this);
      }
      return combineLatest.apply(this, args);
    };
    var combineLatest = Observable.combineLatest = function() {
      var len = arguments.length,
        args = new Array(len);
      for (var i = 0; i < len; i++) {
        args[i] = arguments[i];
      }
      var resultSelector = args.pop();
      Array.isArray(args[0]) && (args = args[0]);
      return new AnonymousObservable(function(o) {
        var n = args.length,
          falseFactory = function() {
            return false;
          },
          hasValue = arrayInitialize(n, falseFactory),
          hasValueAll = false,
          isDone = arrayInitialize(n, falseFactory),
          values = new Array(n);
        function next(i) {
          hasValue[i] = true;
          if (hasValueAll || (hasValueAll = hasValue.every(identity))) {
            try {
              var res = resultSelector.apply(null, values);
            } catch (e) {
              return o.onError(e);
            }
            o.onNext(res);
          } else if (isDone.filter(function(x, j) {
              return j !== i;
            }).every(identity)) {
            o.onCompleted();
          }
        }
        function done(i) {
          isDone[i] = true;
          isDone.every(identity) && o.onCompleted();
        }
        var subscriptions = new Array(n);
        for (var idx = 0; idx < n; idx++) {
          (function(i) {
            var source = args[i],
              sad = new SingleAssignmentDisposable();
            isPromise(source) && (source = observableFromPromise(source));
            sad.setDisposable(source.subscribe(function(x) {
              values[i] = x;
              next(i);
            }, function(e) {
              o.onError(e);
            }, function() {
              done(i);
            }));
            subscriptions[i] = sad;
          }(idx));
        }
        return new CompositeDisposable(subscriptions);
      }, this);
    };
    observableProto.concat = function() {
      for (var args = [],
             i = 0,
             len = arguments.length; i < len; i++) {
        args.push(arguments[i]);
      }
      args.unshift(this);
      return observableConcat.apply(null, args);
    };
    var observableConcat = Observable.concat = function() {
      var args;
      if (Array.isArray(arguments[0])) {
        args = arguments[0];
      } else {
        args = new Array(arguments.length);
        for (var i = 0,
               len = arguments.length; i < len; i++) {
          args[i] = arguments[i];
        }
      }
      return enumerableOf(args).concat();
    };
    observableProto.concatAll = observableProto.concatObservable = function() {
      return this.merge(1);
    };
    var MergeObservable = (function(__super__) {
      inherits(MergeObservable, __super__);
      function MergeObservable(source, maxConcurrent) {
        this.source = source;
        this.maxConcurrent = maxConcurrent;
        __super__.call(this);
      }
      MergeObservable.prototype.subscribeCore = function(observer) {
        var g = new CompositeDisposable();
        g.add(this.source.subscribe(new MergeObserver(observer, this.maxConcurrent, g)));
        return g;
      };
      return MergeObservable;
    }(ObservableBase));
    var MergeObserver = (function() {
      function MergeObserver(o, max, g) {
        this.o = o;
        this.max = max;
        this.g = g;
        this.done = false;
        this.q = [];
        this.activeCount = 0;
        this.isStopped = false;
      }
      MergeObserver.prototype.handleSubscribe = function(xs) {
        var sad = new SingleAssignmentDisposable();
        this.g.add(sad);
        isPromise(xs) && (xs = observableFromPromise(xs));
        sad.setDisposable(xs.subscribe(new InnerObserver(this, sad)));
      };
      MergeObserver.prototype.onNext = function(innerSource) {
        if (this.isStopped) {
          return ;
        }
        if (this.activeCount < this.max) {
          this.activeCount++;
          this.handleSubscribe(innerSource);
        } else {
          this.q.push(innerSource);
        }
      };
      MergeObserver.prototype.onError = function(e) {
        if (!this.isStopped) {
          this.isStopped = true;
          this.o.onError(e);
        }
      };
      MergeObserver.prototype.onCompleted = function() {
        if (!this.isStopped) {
          this.isStopped = true;
          this.done = true;
          this.activeCount === 0 && this.o.onCompleted();
        }
      };
      MergeObserver.prototype.dispose = function() {
        this.isStopped = true;
      };
      MergeObserver.prototype.fail = function(e) {
        if (!this.isStopped) {
          this.isStopped = true;
          this.o.onError(e);
          return true;
        }
        return false;
      };
      function InnerObserver(parent, sad) {
        this.parent = parent;
        this.sad = sad;
        this.isStopped = false;
      }
      InnerObserver.prototype.onNext = function(x) {
        if (!this.isStopped) {
          this.parent.o.onNext(x);
        }
      };
      InnerObserver.prototype.onError = function(e) {
        if (!this.isStopped) {
          this.isStopped = true;
          this.parent.o.onError(e);
        }
      };
      InnerObserver.prototype.onCompleted = function() {
        if (!this.isStopped) {
          this.isStopped = true;
          var parent = this.parent;
          parent.g.remove(this.sad);
          if (parent.q.length > 0) {
            parent.handleSubscribe(parent.q.shift());
          } else {
            parent.activeCount--;
            parent.done && parent.activeCount === 0 && parent.o.onCompleted();
          }
        }
      };
      InnerObserver.prototype.dispose = function() {
        this.isStopped = true;
      };
      InnerObserver.prototype.fail = function(e) {
        if (!this.isStopped) {
          this.isStopped = true;
          this.parent.o.onError(e);
          return true;
        }
        return false;
      };
      return MergeObserver;
    }());
    observableProto.merge = function(maxConcurrentOrOther) {
      return typeof maxConcurrentOrOther !== 'number' ? observableMerge(this, maxConcurrentOrOther) : new MergeObservable(this, maxConcurrentOrOther);
    };
    var observableMerge = Observable.merge = function() {
      var scheduler,
        sources = [],
        i,
        len = arguments.length;
      if (!arguments[0]) {
        scheduler = immediateScheduler;
        for (i = 1; i < len; i++) {
          sources.push(arguments[i]);
        }
      } else if (isScheduler(arguments[0])) {
        scheduler = arguments[0];
        for (i = 1; i < len; i++) {
          sources.push(arguments[i]);
        }
      } else {
        scheduler = immediateScheduler;
        for (i = 0; i < len; i++) {
          sources.push(arguments[i]);
        }
      }
      if (Array.isArray(sources[0])) {
        sources = sources[0];
      }
      return observableOf(scheduler, sources).mergeAll();
    };
    var MergeAllObservable = (function(__super__) {
      inherits(MergeAllObservable, __super__);
      function MergeAllObservable(source) {
        this.source = source;
        __super__.call(this);
      }
      MergeAllObservable.prototype.subscribeCore = function(observer) {
        var g = new CompositeDisposable(),
          m = new SingleAssignmentDisposable();
        g.add(m);
        m.setDisposable(this.source.subscribe(new MergeAllObserver(observer, g)));
        return g;
      };
      return MergeAllObservable;
    }(ObservableBase));
    var MergeAllObserver = (function() {
      function MergeAllObserver(o, g) {
        this.o = o;
        this.g = g;
        this.isStopped = false;
        this.done = false;
      }
      MergeAllObserver.prototype.onNext = function(innerSource) {
        if (this.isStopped) {
          return ;
        }
        var sad = new SingleAssignmentDisposable();
        this.g.add(sad);
        isPromise(innerSource) && (innerSource = observableFromPromise(innerSource));
        sad.setDisposable(innerSource.subscribe(new InnerObserver(this, this.g, sad)));
      };
      MergeAllObserver.prototype.onError = function(e) {
        if (!this.isStopped) {
          this.isStopped = true;
          this.o.onError(e);
        }
      };
      MergeAllObserver.prototype.onCompleted = function() {
        if (!this.isStopped) {
          this.isStopped = true;
          this.done = true;
          this.g.length === 1 && this.o.onCompleted();
        }
      };
      MergeAllObserver.prototype.dispose = function() {
        this.isStopped = true;
      };
      MergeAllObserver.prototype.fail = function(e) {
        if (!this.isStopped) {
          this.isStopped = true;
          this.o.onError(e);
          return true;
        }
        return false;
      };
      function InnerObserver(parent, g, sad) {
        this.parent = parent;
        this.g = g;
        this.sad = sad;
        this.isStopped = false;
      }
      InnerObserver.prototype.onNext = function(x) {
        if (!this.isStopped) {
          this.parent.o.onNext(x);
        }
      };
      InnerObserver.prototype.onError = function(e) {
        if (!this.isStopped) {
          this.isStopped = true;
          this.parent.o.onError(e);
        }
      };
      InnerObserver.prototype.onCompleted = function() {
        if (!this.isStopped) {
          var parent = this.parent;
          this.isStopped = true;
          parent.g.remove(this.sad);
          parent.done && parent.g.length === 1 && parent.o.onCompleted();
        }
      };
      InnerObserver.prototype.dispose = function() {
        this.isStopped = true;
      };
      InnerObserver.prototype.fail = function(e) {
        if (!this.isStopped) {
          this.isStopped = true;
          this.parent.o.onError(e);
          return true;
        }
        return false;
      };
      return MergeAllObserver;
    }());
    observableProto.mergeAll = observableProto.mergeObservable = function() {
      return new MergeAllObservable(this);
    };
    var CompositeError = Rx.CompositeError = function(errors) {
      this.name = "NotImplementedError";
      this.innerErrors = errors;
      this.message = 'This contains multiple errors. Check the innerErrors';
      Error.call(this);
    };
    CompositeError.prototype = Error.prototype;
    Observable.mergeDelayError = function() {
      var args;
      if (Array.isArray(arguments[0])) {
        args = arguments[0];
      } else {
        var len = arguments.length;
        args = new Array(len);
        for (var i = 0; i < len; i++) {
          args[i] = arguments[i];
        }
      }
      var source = observableOf(null, args);
      return new AnonymousObservable(function(o) {
        var group = new CompositeDisposable(),
          m = new SingleAssignmentDisposable(),
          isStopped = false,
          errors = [];
        function setCompletion() {
          if (errors.length === 0) {
            o.onCompleted();
          } else if (errors.length === 1) {
            o.onError(errors[0]);
          } else {
            o.onError(new CompositeError(errors));
          }
        }
        group.add(m);
        m.setDisposable(source.subscribe(function(innerSource) {
          var innerSubscription = new SingleAssignmentDisposable();
          group.add(innerSubscription);
          isPromise(innerSource) && (innerSource = observableFromPromise(innerSource));
          innerSubscription.setDisposable(innerSource.subscribe(function(x) {
            o.onNext(x);
          }, function(e) {
            errors.push(e);
            group.remove(innerSubscription);
            isStopped && group.length === 1 && setCompletion();
          }, function() {
            group.remove(innerSubscription);
            isStopped && group.length === 1 && setCompletion();
          }));
        }, function(e) {
          errors.push(e);
          isStopped = true;
          group.length === 1 && setCompletion();
        }, function() {
          isStopped = true;
          group.length === 1 && setCompletion();
        }));
        return group;
      });
    };
    observableProto.onErrorResumeNext = function(second) {
      if (!second) {
        throw new Error('Second observable is required');
      }
      return onErrorResumeNext([this, second]);
    };
    var onErrorResumeNext = Observable.onErrorResumeNext = function() {
      var sources = [];
      if (Array.isArray(arguments[0])) {
        sources = arguments[0];
      } else {
        for (var i = 0,
               len = arguments.length; i < len; i++) {
          sources.push(arguments[i]);
        }
      }
      return new AnonymousObservable(function(observer) {
        var pos = 0,
          subscription = new SerialDisposable(),
          cancelable = immediateScheduler.scheduleRecursive(function(self) {
            var current,
              d;
            if (pos < sources.length) {
              current = sources[pos++];
              isPromise(current) && (current = observableFromPromise(current));
              d = new SingleAssignmentDisposable();
              subscription.setDisposable(d);
              d.setDisposable(current.subscribe(observer.onNext.bind(observer), self, self));
            } else {
              observer.onCompleted();
            }
          });
        return new CompositeDisposable(subscription, cancelable);
      });
    };
    observableProto.skipUntil = function(other) {
      var source = this;
      return new AnonymousObservable(function(o) {
        var isOpen = false;
        var disposables = new CompositeDisposable(source.subscribe(function(left) {
          isOpen && o.onNext(left);
        }, function(e) {
          o.onError(e);
        }, function() {
          isOpen && o.onCompleted();
        }));
        isPromise(other) && (other = observableFromPromise(other));
        var rightSubscription = new SingleAssignmentDisposable();
        disposables.add(rightSubscription);
        rightSubscription.setDisposable(other.subscribe(function() {
          isOpen = true;
          rightSubscription.dispose();
        }, function(e) {
          o.onError(e);
        }, function() {
          rightSubscription.dispose();
        }));
        return disposables;
      }, source);
    };
    observableProto['switch'] = observableProto.switchLatest = function() {
      var sources = this;
      return new AnonymousObservable(function(observer) {
        var hasLatest = false,
          innerSubscription = new SerialDisposable(),
          isStopped = false,
          latest = 0,
          subscription = sources.subscribe(function(innerSource) {
            var d = new SingleAssignmentDisposable(),
              id = ++latest;
            hasLatest = true;
            innerSubscription.setDisposable(d);
            isPromise(innerSource) && (innerSource = observableFromPromise(innerSource));
            d.setDisposable(innerSource.subscribe(function(x) {
              latest === id && observer.onNext(x);
            }, function(e) {
              latest === id && observer.onError(e);
            }, function() {
              if (latest === id) {
                hasLatest = false;
                isStopped && observer.onCompleted();
              }
            }));
          }, function(e) {
            observer.onError(e);
          }, function() {
            isStopped = true;
            !hasLatest && observer.onCompleted();
          });
        return new CompositeDisposable(subscription, innerSubscription);
      }, sources);
    };
    observableProto.takeUntil = function(other) {
      var source = this;
      return new AnonymousObservable(function(o) {
        isPromise(other) && (other = observableFromPromise(other));
        return new CompositeDisposable(source.subscribe(o), other.subscribe(function() {
          o.onCompleted();
        }, function(e) {
          o.onError(e);
        }, noop));
      }, source);
    };
    observableProto.withLatestFrom = function() {
      var len = arguments.length,
        args = new Array(len);
      for (var i = 0; i < len; i++) {
        args[i] = arguments[i];
      }
      var resultSelector = args.pop(),
        source = this;
      if (typeof source === 'undefined') {
        throw new Error('Source observable not found for withLatestFrom().');
      }
      if (typeof resultSelector !== 'function') {
        throw new Error('withLatestFrom() expects a resultSelector function.');
      }
      if (Array.isArray(args[0])) {
        args = args[0];
      }
      return new AnonymousObservable(function(observer) {
        var falseFactory = function() {
            return false;
          },
          n = args.length,
          hasValue = arrayInitialize(n, falseFactory),
          hasValueAll = false,
          values = new Array(n);
        var subscriptions = new Array(n + 1);
        for (var idx = 0; idx < n; idx++) {
          (function(i) {
            var other = args[i],
              sad = new SingleAssignmentDisposable();
            isPromise(other) && (other = observableFromPromise(other));
            sad.setDisposable(other.subscribe(function(x) {
              values[i] = x;
              hasValue[i] = true;
              hasValueAll = hasValue.every(identity);
            }, observer.onError.bind(observer), function() {}));
            subscriptions[i] = sad;
          }(idx));
        }
        var sad = new SingleAssignmentDisposable();
        sad.setDisposable(source.subscribe(function(x) {
          var res;
          var allValues = [x].concat(values);
          if (!hasValueAll)
            return ;
          try {
            res = resultSelector.apply(null, allValues);
          } catch (ex) {
            observer.onError(ex);
            return ;
          }
          observer.onNext(res);
        }, observer.onError.bind(observer), function() {
          observer.onCompleted();
        }));
        subscriptions[n] = sad;
        return new CompositeDisposable(subscriptions);
      }, this);
    };
    function zipArray(second, resultSelector) {
      var first = this;
      return new AnonymousObservable(function(observer) {
        var index = 0,
          len = second.length;
        return first.subscribe(function(left) {
          if (index < len) {
            var right = second[index++],
              result;
            try {
              result = resultSelector(left, right);
            } catch (e) {
              return observer.onError(e);
            }
            observer.onNext(result);
          } else {
            observer.onCompleted();
          }
        }, function(e) {
          observer.onError(e);
        }, function() {
          observer.onCompleted();
        });
      }, first);
    }
    function falseFactory() {
      return false;
    }
    function emptyArrayFactory() {
      return [];
    }
    observableProto.zip = function() {
      if (Array.isArray(arguments[0])) {
        return zipArray.apply(this, arguments);
      }
      var len = arguments.length,
        args = new Array(len);
      for (var i = 0; i < len; i++) {
        args[i] = arguments[i];
      }
      var parent = this,
        resultSelector = args.pop();
      args.unshift(parent);
      return new AnonymousObservable(function(observer) {
        var n = args.length,
          queues = arrayInitialize(n, emptyArrayFactory),
          isDone = arrayInitialize(n, falseFactory);
        function next(i) {
          var res,
            queuedValues;
          if (queues.every(function(x) {
              return x.length > 0;
            })) {
            try {
              queuedValues = queues.map(function(x) {
                return x.shift();
              });
              res = resultSelector.apply(parent, queuedValues);
            } catch (ex) {
              observer.onError(ex);
              return ;
            }
            observer.onNext(res);
          } else if (isDone.filter(function(x, j) {
              return j !== i;
            }).every(identity)) {
            observer.onCompleted();
          }
        }
        ;
        function done(i) {
          isDone[i] = true;
          if (isDone.every(function(x) {
              return x;
            })) {
            observer.onCompleted();
          }
        }
        var subscriptions = new Array(n);
        for (var idx = 0; idx < n; idx++) {
          (function(i) {
            var source = args[i],
              sad = new SingleAssignmentDisposable();
            isPromise(source) && (source = observableFromPromise(source));
            sad.setDisposable(source.subscribe(function(x) {
              queues[i].push(x);
              next(i);
            }, function(e) {
              observer.onError(e);
            }, function() {
              done(i);
            }));
            subscriptions[i] = sad;
          })(idx);
        }
        return new CompositeDisposable(subscriptions);
      }, parent);
    };
    Observable.zip = function() {
      var len = arguments.length,
        args = new Array(len);
      for (var i = 0; i < len; i++) {
        args[i] = arguments[i];
      }
      var first = args.shift();
      return first.zip.apply(first, args);
    };
    Observable.zipArray = function() {
      var sources;
      if (Array.isArray(arguments[0])) {
        sources = arguments[0];
      } else {
        var len = arguments.length;
        sources = new Array(len);
        for (var i = 0; i < len; i++) {
          sources[i] = arguments[i];
        }
      }
      return new AnonymousObservable(function(observer) {
        var n = sources.length,
          queues = arrayInitialize(n, function() {
            return [];
          }),
          isDone = arrayInitialize(n, function() {
            return false;
          });
        function next(i) {
          if (queues.every(function(x) {
              return x.length > 0;
            })) {
            var res = queues.map(function(x) {
              return x.shift();
            });
            observer.onNext(res);
          } else if (isDone.filter(function(x, j) {
              return j !== i;
            }).every(identity)) {
            observer.onCompleted();
            return ;
          }
        }
        ;
        function done(i) {
          isDone[i] = true;
          if (isDone.every(identity)) {
            observer.onCompleted();
            return ;
          }
        }
        var subscriptions = new Array(n);
        for (var idx = 0; idx < n; idx++) {
          (function(i) {
            subscriptions[i] = new SingleAssignmentDisposable();
            subscriptions[i].setDisposable(sources[i].subscribe(function(x) {
              queues[i].push(x);
              next(i);
            }, function(e) {
              observer.onError(e);
            }, function() {
              done(i);
            }));
          })(idx);
        }
        return new CompositeDisposable(subscriptions);
      });
    };
    observableProto.asObservable = function() {
      var source = this;
      return new AnonymousObservable(function(o) {
        return source.subscribe(o);
      }, this);
    };
    observableProto.bufferWithCount = function(count, skip) {
      if (typeof skip !== 'number') {
        skip = count;
      }
      return this.windowWithCount(count, skip).selectMany(function(x) {
        return x.toArray();
      }).where(function(x) {
        return x.length > 0;
      });
    };
    observableProto.dematerialize = function() {
      var source = this;
      return new AnonymousObservable(function(o) {
        return source.subscribe(function(x) {
          return x.accept(o);
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onCompleted();
        });
      }, this);
    };
    observableProto.distinctUntilChanged = function(keySelector, comparer) {
      var source = this;
      comparer || (comparer = defaultComparer);
      return new AnonymousObservable(function(o) {
        var hasCurrentKey = false,
          currentKey;
        return source.subscribe(function(value) {
          var key = value;
          if (keySelector) {
            try {
              key = keySelector(value);
            } catch (e) {
              o.onError(e);
              return ;
            }
          }
          if (hasCurrentKey) {
            try {
              var comparerEquals = comparer(currentKey, key);
            } catch (e) {
              o.onError(e);
              return ;
            }
          }
          if (!hasCurrentKey || !comparerEquals) {
            hasCurrentKey = true;
            currentKey = key;
            o.onNext(value);
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onCompleted();
        });
      }, this);
    };
    observableProto['do'] = observableProto.tap = observableProto.doAction = function(observerOrOnNext, onError, onCompleted) {
      var source = this;
      return new AnonymousObservable(function(observer) {
        var tapObserver = !observerOrOnNext || isFunction(observerOrOnNext) ? observerCreate(observerOrOnNext || noop, onError || noop, onCompleted || noop) : observerOrOnNext;
        return source.subscribe(function(x) {
          try {
            tapObserver.onNext(x);
          } catch (e) {
            observer.onError(e);
          }
          observer.onNext(x);
        }, function(err) {
          try {
            tapObserver.onError(err);
          } catch (e) {
            observer.onError(e);
          }
          observer.onError(err);
        }, function() {
          try {
            tapObserver.onCompleted();
          } catch (e) {
            observer.onError(e);
          }
          observer.onCompleted();
        });
      }, this);
    };
    observableProto.doOnNext = observableProto.tapOnNext = function(onNext, thisArg) {
      return this.tap(typeof thisArg !== 'undefined' ? function(x) {
        onNext.call(thisArg, x);
      } : onNext);
    };
    observableProto.doOnError = observableProto.tapOnError = function(onError, thisArg) {
      return this.tap(noop, typeof thisArg !== 'undefined' ? function(e) {
        onError.call(thisArg, e);
      } : onError);
    };
    observableProto.doOnCompleted = observableProto.tapOnCompleted = function(onCompleted, thisArg) {
      return this.tap(noop, null, typeof thisArg !== 'undefined' ? function() {
        onCompleted.call(thisArg);
      } : onCompleted);
    };
    observableProto['finally'] = observableProto.ensure = function(action) {
      var source = this;
      return new AnonymousObservable(function(observer) {
        var subscription;
        try {
          subscription = source.subscribe(observer);
        } catch (e) {
          action();
          throw e;
        }
        return disposableCreate(function() {
          try {
            subscription.dispose();
          } catch (e) {
            throw e;
          } finally {
            action();
          }
        });
      }, this);
    };
    observableProto.finallyAction = function(action) {
      return this.ensure(action);
    };
    observableProto.ignoreElements = function() {
      var source = this;
      return new AnonymousObservable(function(o) {
        return source.subscribe(noop, function(e) {
          o.onError(e);
        }, function() {
          o.onCompleted();
        });
      }, source);
    };
    observableProto.materialize = function() {
      var source = this;
      return new AnonymousObservable(function(observer) {
        return source.subscribe(function(value) {
          observer.onNext(notificationCreateOnNext(value));
        }, function(e) {
          observer.onNext(notificationCreateOnError(e));
          observer.onCompleted();
        }, function() {
          observer.onNext(notificationCreateOnCompleted());
          observer.onCompleted();
        });
      }, source);
    };
    observableProto.repeat = function(repeatCount) {
      return enumerableRepeat(this, repeatCount).concat();
    };
    observableProto.retry = function(retryCount) {
      return enumerableRepeat(this, retryCount).catchError();
    };
    observableProto.retryWhen = function(notifier) {
      return enumerableRepeat(this).catchErrorWhen(notifier);
    };
    observableProto.scan = function() {
      var hasSeed = false,
        seed,
        accumulator,
        source = this;
      if (arguments.length === 2) {
        hasSeed = true;
        seed = arguments[0];
        accumulator = arguments[1];
      } else {
        accumulator = arguments[0];
      }
      return new AnonymousObservable(function(o) {
        var hasAccumulation,
          accumulation,
          hasValue;
        return source.subscribe(function(x) {
          !hasValue && (hasValue = true);
          try {
            if (hasAccumulation) {
              accumulation = accumulator(accumulation, x);
            } else {
              accumulation = hasSeed ? accumulator(seed, x) : x;
              hasAccumulation = true;
            }
          } catch (e) {
            o.onError(e);
            return ;
          }
          o.onNext(accumulation);
        }, function(e) {
          o.onError(e);
        }, function() {
          !hasValue && hasSeed && o.onNext(seed);
          o.onCompleted();
        });
      }, source);
    };
    observableProto.skipLast = function(count) {
      if (count < 0) {
        throw new ArgumentOutOfRangeError();
      }
      var source = this;
      return new AnonymousObservable(function(o) {
        var q = [];
        return source.subscribe(function(x) {
          q.push(x);
          q.length > count && o.onNext(q.shift());
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onCompleted();
        });
      }, source);
    };
    observableProto.startWith = function() {
      var values,
        scheduler,
        start = 0;
      if (!!arguments.length && isScheduler(arguments[0])) {
        scheduler = arguments[0];
        start = 1;
      } else {
        scheduler = immediateScheduler;
      }
      for (var args = [],
             i = start,
             len = arguments.length; i < len; i++) {
        args.push(arguments[i]);
      }
      return enumerableOf([observableFromArray(args, scheduler), this]).concat();
    };
    observableProto.takeLast = function(count) {
      if (count < 0) {
        throw new ArgumentOutOfRangeError();
      }
      var source = this;
      return new AnonymousObservable(function(o) {
        var q = [];
        return source.subscribe(function(x) {
          q.push(x);
          q.length > count && q.shift();
        }, function(e) {
          o.onError(e);
        }, function() {
          while (q.length > 0) {
            o.onNext(q.shift());
          }
          o.onCompleted();
        });
      }, source);
    };
    observableProto.takeLastBuffer = function(count) {
      var source = this;
      return new AnonymousObservable(function(o) {
        var q = [];
        return source.subscribe(function(x) {
          q.push(x);
          q.length > count && q.shift();
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onNext(q);
          o.onCompleted();
        });
      }, source);
    };
    observableProto.windowWithCount = function(count, skip) {
      var source = this;
      +count || (count = 0);
      Math.abs(count) === Infinity && (count = 0);
      if (count <= 0) {
        throw new ArgumentOutOfRangeError();
      }
      skip == null && (skip = count);
      +skip || (skip = 0);
      Math.abs(skip) === Infinity && (skip = 0);
      if (skip <= 0) {
        throw new ArgumentOutOfRangeError();
      }
      return new AnonymousObservable(function(observer) {
        var m = new SingleAssignmentDisposable(),
          refCountDisposable = new RefCountDisposable(m),
          n = 0,
          q = [];
        function createWindow() {
          var s = new Subject();
          q.push(s);
          observer.onNext(addRef(s, refCountDisposable));
        }
        createWindow();
        m.setDisposable(source.subscribe(function(x) {
          for (var i = 0,
                 len = q.length; i < len; i++) {
            q[i].onNext(x);
          }
          var c = n - count + 1;
          c >= 0 && c % skip === 0 && q.shift().onCompleted();
          ++n % skip === 0 && createWindow();
        }, function(e) {
          while (q.length > 0) {
            q.shift().onError(e);
          }
          observer.onError(e);
        }, function() {
          while (q.length > 0) {
            q.shift().onCompleted();
          }
          observer.onCompleted();
        }));
        return refCountDisposable;
      }, source);
    };
    function concatMap(source, selector, thisArg) {
      var selectorFunc = bindCallback(selector, thisArg, 3);
      return source.map(function(x, i) {
        var result = selectorFunc(x, i, source);
        isPromise(result) && (result = observableFromPromise(result));
        (isArrayLike(result) || isIterable(result)) && (result = observableFrom(result));
        return result;
      }).concatAll();
    }
    observableProto.selectConcat = observableProto.concatMap = function(selector, resultSelector, thisArg) {
      if (isFunction(selector) && isFunction(resultSelector)) {
        return this.concatMap(function(x, i) {
          var selectorResult = selector(x, i);
          isPromise(selectorResult) && (selectorResult = observableFromPromise(selectorResult));
          (isArrayLike(selectorResult) || isIterable(selectorResult)) && (selectorResult = observableFrom(selectorResult));
          return selectorResult.map(function(y, i2) {
            return resultSelector(x, y, i, i2);
          });
        });
      }
      return isFunction(selector) ? concatMap(this, selector, thisArg) : concatMap(this, function() {
        return selector;
      });
    };
    observableProto.concatMapObserver = observableProto.selectConcatObserver = function(onNext, onError, onCompleted, thisArg) {
      var source = this,
        onNextFunc = bindCallback(onNext, thisArg, 2),
        onErrorFunc = bindCallback(onError, thisArg, 1),
        onCompletedFunc = bindCallback(onCompleted, thisArg, 0);
      return new AnonymousObservable(function(observer) {
        var index = 0;
        return source.subscribe(function(x) {
          var result;
          try {
            result = onNextFunc(x, index++);
          } catch (e) {
            observer.onError(e);
            return ;
          }
          isPromise(result) && (result = observableFromPromise(result));
          observer.onNext(result);
        }, function(err) {
          var result;
          try {
            result = onErrorFunc(err);
          } catch (e) {
            observer.onError(e);
            return ;
          }
          isPromise(result) && (result = observableFromPromise(result));
          observer.onNext(result);
          observer.onCompleted();
        }, function() {
          var result;
          try {
            result = onCompletedFunc();
          } catch (e) {
            observer.onError(e);
            return ;
          }
          isPromise(result) && (result = observableFromPromise(result));
          observer.onNext(result);
          observer.onCompleted();
        });
      }, this).concatAll();
    };
    observableProto.defaultIfEmpty = function(defaultValue) {
      var source = this;
      defaultValue === undefined && (defaultValue = null);
      return new AnonymousObservable(function(observer) {
        var found = false;
        return source.subscribe(function(x) {
          found = true;
          observer.onNext(x);
        }, function(e) {
          observer.onError(e);
        }, function() {
          !found && observer.onNext(defaultValue);
          observer.onCompleted();
        });
      }, source);
    };
    function arrayIndexOfComparer(array, item, comparer) {
      for (var i = 0,
             len = array.length; i < len; i++) {
        if (comparer(array[i], item)) {
          return i;
        }
      }
      return -1;
    }
    function HashSet(comparer) {
      this.comparer = comparer;
      this.set = [];
    }
    HashSet.prototype.push = function(value) {
      var retValue = arrayIndexOfComparer(this.set, value, this.comparer) === -1;
      retValue && this.set.push(value);
      return retValue;
    };
    observableProto.distinct = function(keySelector, comparer) {
      var source = this;
      comparer || (comparer = defaultComparer);
      return new AnonymousObservable(function(o) {
        var hashSet = new HashSet(comparer);
        return source.subscribe(function(x) {
          var key = x;
          if (keySelector) {
            try {
              key = keySelector(x);
            } catch (e) {
              o.onError(e);
              return ;
            }
          }
          hashSet.push(key) && o.onNext(x);
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onCompleted();
        });
      }, this);
    };
    observableProto.groupBy = function(keySelector, elementSelector, comparer) {
      return this.groupByUntil(keySelector, elementSelector, observableNever, comparer);
    };
    observableProto.groupByUntil = function(keySelector, elementSelector, durationSelector, comparer) {
      var source = this;
      elementSelector || (elementSelector = identity);
      comparer || (comparer = defaultComparer);
      return new AnonymousObservable(function(observer) {
        function handleError(e) {
          return function(item) {
            item.onError(e);
          };
        }
        var map = new Dictionary(0, comparer),
          groupDisposable = new CompositeDisposable(),
          refCountDisposable = new RefCountDisposable(groupDisposable);
        groupDisposable.add(source.subscribe(function(x) {
          var key;
          try {
            key = keySelector(x);
          } catch (e) {
            map.getValues().forEach(handleError(e));
            observer.onError(e);
            return ;
          }
          var fireNewMapEntry = false,
            writer = map.tryGetValue(key);
          if (!writer) {
            writer = new Subject();
            map.set(key, writer);
            fireNewMapEntry = true;
          }
          if (fireNewMapEntry) {
            var group = new GroupedObservable(key, writer, refCountDisposable),
              durationGroup = new GroupedObservable(key, writer);
            try {
              duration = durationSelector(durationGroup);
            } catch (e) {
              map.getValues().forEach(handleError(e));
              observer.onError(e);
              return ;
            }
            observer.onNext(group);
            var md = new SingleAssignmentDisposable();
            groupDisposable.add(md);
            var expire = function() {
              map.remove(key) && writer.onCompleted();
              groupDisposable.remove(md);
            };
            md.setDisposable(duration.take(1).subscribe(noop, function(exn) {
              map.getValues().forEach(handleError(exn));
              observer.onError(exn);
            }, expire));
          }
          var element;
          try {
            element = elementSelector(x);
          } catch (e) {
            map.getValues().forEach(handleError(e));
            observer.onError(e);
            return ;
          }
          writer.onNext(element);
        }, function(ex) {
          map.getValues().forEach(handleError(ex));
          observer.onError(ex);
        }, function() {
          map.getValues().forEach(function(item) {
            item.onCompleted();
          });
          observer.onCompleted();
        }));
        return refCountDisposable;
      }, source);
    };
    var MapObservable = (function(__super__) {
      inherits(MapObservable, __super__);
      function MapObservable(source, selector, thisArg) {
        this.source = source;
        this.selector = bindCallback(selector, thisArg, 3);
        __super__.call(this);
      }
      MapObservable.prototype.internalMap = function(selector, thisArg) {
        var self = this;
        return new MapObservable(this.source, function(x, i, o) {
          return selector.call(this, self.selector(x, i, o), i, o);
        }, thisArg);
      };
      MapObservable.prototype.subscribeCore = function(observer) {
        return this.source.subscribe(new MapObserver(observer, this.selector, this));
      };
      return MapObservable;
    }(ObservableBase));
    function MapObserver(observer, selector, source) {
      this.observer = observer;
      this.selector = selector;
      this.source = source;
      this.i = 0;
      this.isStopped = false;
    }
    MapObserver.prototype.onNext = function(x) {
      if (this.isStopped) {
        return ;
      }
      var result = tryCatch(this.selector).call(this, x, this.i++, this.source);
      if (result === errorObj) {
        return this.observer.onError(result.e);
      }
      this.observer.onNext(result);
    };
    MapObserver.prototype.onError = function(e) {
      if (!this.isStopped) {
        this.isStopped = true;
        this.observer.onError(e);
      }
    };
    MapObserver.prototype.onCompleted = function() {
      if (!this.isStopped) {
        this.isStopped = true;
        this.observer.onCompleted();
      }
    };
    MapObserver.prototype.dispose = function() {
      this.isStopped = true;
    };
    MapObserver.prototype.fail = function(e) {
      if (!this.isStopped) {
        this.isStopped = true;
        this.observer.onError(e);
        return true;
      }
      return false;
    };
    observableProto.map = observableProto.select = function(selector, thisArg) {
      var selectorFn = typeof selector === 'function' ? selector : function() {
        return selector;
      };
      return this instanceof MapObservable ? this.internalMap(selectorFn, thisArg) : new MapObservable(this, selectorFn, thisArg);
    };
    observableProto.pluck = function() {
      var args = arguments,
        len = arguments.length;
      if (len === 0) {
        throw new Error('List of properties cannot be empty.');
      }
      return this.map(function(x) {
        var currentProp = x;
        for (var i = 0; i < len; i++) {
          var p = currentProp[args[i]];
          if (typeof p !== 'undefined') {
            currentProp = p;
          } else {
            return undefined;
          }
        }
        return currentProp;
      });
    };
    function flatMap(source, selector, thisArg) {
      var selectorFunc = bindCallback(selector, thisArg, 3);
      return source.map(function(x, i) {
        var result = selectorFunc(x, i, source);
        isPromise(result) && (result = observableFromPromise(result));
        (isArrayLike(result) || isIterable(result)) && (result = observableFrom(result));
        return result;
      }).mergeAll();
    }
    observableProto.selectMany = observableProto.flatMap = function(selector, resultSelector, thisArg) {
      if (isFunction(selector) && isFunction(resultSelector)) {
        return this.flatMap(function(x, i) {
          var selectorResult = selector(x, i);
          isPromise(selectorResult) && (selectorResult = observableFromPromise(selectorResult));
          (isArrayLike(selectorResult) || isIterable(selectorResult)) && (selectorResult = observableFrom(selectorResult));
          return selectorResult.map(function(y, i2) {
            return resultSelector(x, y, i, i2);
          });
        }, thisArg);
      }
      return isFunction(selector) ? flatMap(this, selector, thisArg) : flatMap(this, function() {
        return selector;
      });
    };
    observableProto.flatMapObserver = observableProto.selectManyObserver = function(onNext, onError, onCompleted, thisArg) {
      var source = this;
      return new AnonymousObservable(function(observer) {
        var index = 0;
        return source.subscribe(function(x) {
          var result;
          try {
            result = onNext.call(thisArg, x, index++);
          } catch (e) {
            observer.onError(e);
            return ;
          }
          isPromise(result) && (result = observableFromPromise(result));
          observer.onNext(result);
        }, function(err) {
          var result;
          try {
            result = onError.call(thisArg, err);
          } catch (e) {
            observer.onError(e);
            return ;
          }
          isPromise(result) && (result = observableFromPromise(result));
          observer.onNext(result);
          observer.onCompleted();
        }, function() {
          var result;
          try {
            result = onCompleted.call(thisArg);
          } catch (e) {
            observer.onError(e);
            return ;
          }
          isPromise(result) && (result = observableFromPromise(result));
          observer.onNext(result);
          observer.onCompleted();
        });
      }, source).mergeAll();
    };
    observableProto.selectSwitch = observableProto.flatMapLatest = observableProto.switchMap = function(selector, thisArg) {
      return this.select(selector, thisArg).switchLatest();
    };
    observableProto.skip = function(count) {
      if (count < 0) {
        throw new ArgumentOutOfRangeError();
      }
      var source = this;
      return new AnonymousObservable(function(o) {
        var remaining = count;
        return source.subscribe(function(x) {
          if (remaining <= 0) {
            o.onNext(x);
          } else {
            remaining--;
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onCompleted();
        });
      }, source);
    };
    observableProto.skipWhile = function(predicate, thisArg) {
      var source = this,
        callback = bindCallback(predicate, thisArg, 3);
      return new AnonymousObservable(function(o) {
        var i = 0,
          running = false;
        return source.subscribe(function(x) {
          if (!running) {
            try {
              running = !callback(x, i++, source);
            } catch (e) {
              o.onError(e);
              return ;
            }
          }
          running && o.onNext(x);
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onCompleted();
        });
      }, source);
    };
    observableProto.take = function(count, scheduler) {
      if (count < 0) {
        throw new ArgumentOutOfRangeError();
      }
      if (count === 0) {
        return observableEmpty(scheduler);
      }
      var source = this;
      return new AnonymousObservable(function(o) {
        var remaining = count;
        return source.subscribe(function(x) {
          if (remaining-- > 0) {
            o.onNext(x);
            remaining === 0 && o.onCompleted();
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onCompleted();
        });
      }, source);
    };
    observableProto.takeWhile = function(predicate, thisArg) {
      var source = this,
        callback = bindCallback(predicate, thisArg, 3);
      return new AnonymousObservable(function(o) {
        var i = 0,
          running = true;
        return source.subscribe(function(x) {
          if (running) {
            try {
              running = callback(x, i++, source);
            } catch (e) {
              o.onError(e);
              return ;
            }
            if (running) {
              o.onNext(x);
            } else {
              o.onCompleted();
            }
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onCompleted();
        });
      }, source);
    };
    var FilterObservable = (function(__super__) {
      inherits(FilterObservable, __super__);
      function FilterObservable(source, predicate, thisArg) {
        this.source = source;
        this.predicate = bindCallback(predicate, thisArg, 3);
        __super__.call(this);
      }
      FilterObservable.prototype.subscribeCore = function(observer) {
        return this.source.subscribe(new FilterObserver(observer, this.predicate, this));
      };
      FilterObservable.prototype.internalFilter = function(predicate, thisArg) {
        var self = this;
        return new FilterObservable(this.source, function(x, i, o) {
          return self.predicate(x, i, o) && predicate.call(this, x, i, o);
        }, thisArg);
      };
      return FilterObservable;
    }(ObservableBase));
    function FilterObserver(observer, predicate, source) {
      this.observer = observer;
      this.predicate = predicate;
      this.source = source;
      this.i = 0;
      this.isStopped = false;
    }
    FilterObserver.prototype.onNext = function(x) {
      if (this.isStopped) {
        return ;
      }
      var shouldYield = tryCatch(this.predicate).call(this, x, this.i++, this.source);
      if (shouldYield === errorObj) {
        return this.observer.onError(shouldYield.e);
      }
      shouldYield && this.observer.onNext(x);
    };
    FilterObserver.prototype.onError = function(e) {
      if (!this.isStopped) {
        this.isStopped = true;
        this.observer.onError(e);
      }
    };
    FilterObserver.prototype.onCompleted = function() {
      if (!this.isStopped) {
        this.isStopped = true;
        this.observer.onCompleted();
      }
    };
    FilterObserver.prototype.dispose = function() {
      this.isStopped = true;
    };
    FilterObserver.prototype.fail = function(e) {
      if (!this.isStopped) {
        this.isStopped = true;
        this.observer.onError(e);
        return true;
      }
      return false;
    };
    observableProto.filter = observableProto.where = function(predicate, thisArg) {
      return this instanceof FilterObservable ? this.internalFilter(predicate, thisArg) : new FilterObservable(this, predicate, thisArg);
    };
    function extremaBy(source, keySelector, comparer) {
      return new AnonymousObservable(function(o) {
        var hasValue = false,
          lastKey = null,
          list = [];
        return source.subscribe(function(x) {
          var comparison,
            key;
          try {
            key = keySelector(x);
          } catch (ex) {
            o.onError(ex);
            return ;
          }
          comparison = 0;
          if (!hasValue) {
            hasValue = true;
            lastKey = key;
          } else {
            try {
              comparison = comparer(key, lastKey);
            } catch (ex1) {
              o.onError(ex1);
              return ;
            }
          }
          if (comparison > 0) {
            lastKey = key;
            list = [];
          }
          if (comparison >= 0) {
            list.push(x);
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onNext(list);
          o.onCompleted();
        });
      }, source);
    }
    function firstOnly(x) {
      if (x.length === 0) {
        throw new EmptyError();
      }
      return x[0];
    }
    observableProto.aggregate = function() {
      var hasSeed = false,
        accumulator,
        seed,
        source = this;
      if (arguments.length === 2) {
        hasSeed = true;
        seed = arguments[0];
        accumulator = arguments[1];
      } else {
        accumulator = arguments[0];
      }
      return new AnonymousObservable(function(o) {
        var hasAccumulation,
          accumulation,
          hasValue;
        return source.subscribe(function(x) {
          !hasValue && (hasValue = true);
          try {
            if (hasAccumulation) {
              accumulation = accumulator(accumulation, x);
            } else {
              accumulation = hasSeed ? accumulator(seed, x) : x;
              hasAccumulation = true;
            }
          } catch (e) {
            return o.onError(e);
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          hasValue && o.onNext(accumulation);
          !hasValue && hasSeed && o.onNext(seed);
          !hasValue && !hasSeed && o.onError(new EmptyError());
          o.onCompleted();
        });
      }, source);
    };
    observableProto.reduce = function(accumulator) {
      var hasSeed = false,
        seed,
        source = this;
      if (arguments.length === 2) {
        hasSeed = true;
        seed = arguments[1];
      }
      return new AnonymousObservable(function(o) {
        var hasAccumulation,
          accumulation,
          hasValue;
        return source.subscribe(function(x) {
          !hasValue && (hasValue = true);
          try {
            if (hasAccumulation) {
              accumulation = accumulator(accumulation, x);
            } else {
              accumulation = hasSeed ? accumulator(seed, x) : x;
              hasAccumulation = true;
            }
          } catch (e) {
            return o.onError(e);
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          hasValue && o.onNext(accumulation);
          !hasValue && hasSeed && o.onNext(seed);
          !hasValue && !hasSeed && o.onError(new EmptyError());
          o.onCompleted();
        });
      }, source);
    };
    observableProto.some = function(predicate, thisArg) {
      var source = this;
      return predicate ? source.filter(predicate, thisArg).some() : new AnonymousObservable(function(observer) {
        return source.subscribe(function() {
          observer.onNext(true);
          observer.onCompleted();
        }, function(e) {
          observer.onError(e);
        }, function() {
          observer.onNext(false);
          observer.onCompleted();
        });
      }, source);
    };
    observableProto.any = function() {
      return this.some.apply(this, arguments);
    };
    observableProto.isEmpty = function() {
      return this.any().map(not);
    };
    observableProto.every = function(predicate, thisArg) {
      return this.filter(function(v) {
        return !predicate(v);
      }, thisArg).some().map(not);
    };
    observableProto.all = function() {
      return this.every.apply(this, arguments);
    };
    observableProto.includes = function(searchElement, fromIndex) {
      var source = this;
      function comparer(a, b) {
        return (a === 0 && b === 0) || (a === b || (isNaN(a) && isNaN(b)));
      }
      return new AnonymousObservable(function(o) {
        var i = 0,
          n = +fromIndex || 0;
        Math.abs(n) === Infinity && (n = 0);
        if (n < 0) {
          o.onNext(false);
          o.onCompleted();
          return disposableEmpty;
        }
        return source.subscribe(function(x) {
          if (i++ >= n && comparer(x, searchElement)) {
            o.onNext(true);
            o.onCompleted();
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onNext(false);
          o.onCompleted();
        });
      }, this);
    };
    observableProto.contains = function(searchElement, fromIndex) {
      observableProto.includes(searchElement, fromIndex);
    };
    observableProto.count = function(predicate, thisArg) {
      return predicate ? this.filter(predicate, thisArg).count() : this.reduce(function(count) {
        return count + 1;
      }, 0);
    };
    observableProto.indexOf = function(searchElement, fromIndex) {
      var source = this;
      return new AnonymousObservable(function(o) {
        var i = 0,
          n = +fromIndex || 0;
        Math.abs(n) === Infinity && (n = 0);
        if (n < 0) {
          o.onNext(-1);
          o.onCompleted();
          return disposableEmpty;
        }
        return source.subscribe(function(x) {
          if (i >= n && x === searchElement) {
            o.onNext(i);
            o.onCompleted();
          }
          i++;
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onNext(-1);
          o.onCompleted();
        });
      }, source);
    };
    observableProto.sum = function(keySelector, thisArg) {
      return keySelector && isFunction(keySelector) ? this.map(keySelector, thisArg).sum() : this.reduce(function(prev, curr) {
        return prev + curr;
      }, 0);
    };
    observableProto.minBy = function(keySelector, comparer) {
      comparer || (comparer = defaultSubComparer);
      return extremaBy(this, keySelector, function(x, y) {
        return comparer(x, y) * -1;
      });
    };
    observableProto.min = function(comparer) {
      return this.minBy(identity, comparer).map(function(x) {
        return firstOnly(x);
      });
    };
    observableProto.maxBy = function(keySelector, comparer) {
      comparer || (comparer = defaultSubComparer);
      return extremaBy(this, keySelector, comparer);
    };
    observableProto.max = function(comparer) {
      return this.maxBy(identity, comparer).map(function(x) {
        return firstOnly(x);
      });
    };
    observableProto.average = function(keySelector, thisArg) {
      return keySelector && isFunction(keySelector) ? this.map(keySelector, thisArg).average() : this.reduce(function(prev, cur) {
        return {
          sum: prev.sum + cur,
          count: prev.count + 1
        };
      }, {
        sum: 0,
        count: 0
      }).map(function(s) {
        if (s.count === 0) {
          throw new EmptyError();
        }
        return s.sum / s.count;
      });
    };
    observableProto.sequenceEqual = function(second, comparer) {
      var first = this;
      comparer || (comparer = defaultComparer);
      return new AnonymousObservable(function(o) {
        var donel = false,
          doner = false,
          ql = [],
          qr = [];
        var subscription1 = first.subscribe(function(x) {
          var equal,
            v;
          if (qr.length > 0) {
            v = qr.shift();
            try {
              equal = comparer(v, x);
            } catch (e) {
              o.onError(e);
              return ;
            }
            if (!equal) {
              o.onNext(false);
              o.onCompleted();
            }
          } else if (doner) {
            o.onNext(false);
            o.onCompleted();
          } else {
            ql.push(x);
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          donel = true;
          if (ql.length === 0) {
            if (qr.length > 0) {
              o.onNext(false);
              o.onCompleted();
            } else if (doner) {
              o.onNext(true);
              o.onCompleted();
            }
          }
        });
        (isArrayLike(second) || isIterable(second)) && (second = observableFrom(second));
        isPromise(second) && (second = observableFromPromise(second));
        var subscription2 = second.subscribe(function(x) {
          var equal;
          if (ql.length > 0) {
            var v = ql.shift();
            try {
              equal = comparer(v, x);
            } catch (exception) {
              o.onError(exception);
              return ;
            }
            if (!equal) {
              o.onNext(false);
              o.onCompleted();
            }
          } else if (donel) {
            o.onNext(false);
            o.onCompleted();
          } else {
            qr.push(x);
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          doner = true;
          if (qr.length === 0) {
            if (ql.length > 0) {
              o.onNext(false);
              o.onCompleted();
            } else if (donel) {
              o.onNext(true);
              o.onCompleted();
            }
          }
        });
        return new CompositeDisposable(subscription1, subscription2);
      }, first);
    };
    function elementAtOrDefault(source, index, hasDefault, defaultValue) {
      if (index < 0) {
        throw new ArgumentOutOfRangeError();
      }
      return new AnonymousObservable(function(o) {
        var i = index;
        return source.subscribe(function(x) {
          if (i-- === 0) {
            o.onNext(x);
            o.onCompleted();
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          if (!hasDefault) {
            o.onError(new ArgumentOutOfRangeError());
          } else {
            o.onNext(defaultValue);
            o.onCompleted();
          }
        });
      }, source);
    }
    observableProto.elementAt = function(index) {
      return elementAtOrDefault(this, index, false);
    };
    observableProto.elementAtOrDefault = function(index, defaultValue) {
      return elementAtOrDefault(this, index, true, defaultValue);
    };
    function singleOrDefaultAsync(source, hasDefault, defaultValue) {
      return new AnonymousObservable(function(o) {
        var value = defaultValue,
          seenValue = false;
        return source.subscribe(function(x) {
          if (seenValue) {
            o.onError(new Error('Sequence contains more than one element'));
          } else {
            value = x;
            seenValue = true;
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          if (!seenValue && !hasDefault) {
            o.onError(new EmptyError());
          } else {
            o.onNext(value);
            o.onCompleted();
          }
        });
      }, source);
    }
    observableProto.single = function(predicate, thisArg) {
      return predicate && isFunction(predicate) ? this.where(predicate, thisArg).single() : singleOrDefaultAsync(this, false);
    };
    observableProto.singleOrDefault = function(predicate, defaultValue, thisArg) {
      return predicate && isFunction(predicate) ? this.filter(predicate, thisArg).singleOrDefault(null, defaultValue) : singleOrDefaultAsync(this, true, defaultValue);
    };
    function firstOrDefaultAsync(source, hasDefault, defaultValue) {
      return new AnonymousObservable(function(o) {
        return source.subscribe(function(x) {
          o.onNext(x);
          o.onCompleted();
        }, function(e) {
          o.onError(e);
        }, function() {
          if (!hasDefault) {
            o.onError(new EmptyError());
          } else {
            o.onNext(defaultValue);
            o.onCompleted();
          }
        });
      }, source);
    }
    observableProto.first = function(predicate, thisArg) {
      return predicate ? this.where(predicate, thisArg).first() : firstOrDefaultAsync(this, false);
    };
    observableProto.firstOrDefault = function(predicate, defaultValue, thisArg) {
      return predicate ? this.where(predicate).firstOrDefault(null, defaultValue) : firstOrDefaultAsync(this, true, defaultValue);
    };
    function lastOrDefaultAsync(source, hasDefault, defaultValue) {
      return new AnonymousObservable(function(o) {
        var value = defaultValue,
          seenValue = false;
        return source.subscribe(function(x) {
          value = x;
          seenValue = true;
        }, function(e) {
          o.onError(e);
        }, function() {
          if (!seenValue && !hasDefault) {
            o.onError(new EmptyError());
          } else {
            o.onNext(value);
            o.onCompleted();
          }
        });
      }, source);
    }
    observableProto.last = function(predicate, thisArg) {
      return predicate ? this.where(predicate, thisArg).last() : lastOrDefaultAsync(this, false);
    };
    observableProto.lastOrDefault = function(predicate, defaultValue, thisArg) {
      return predicate ? this.where(predicate, thisArg).lastOrDefault(null, defaultValue) : lastOrDefaultAsync(this, true, defaultValue);
    };
    function findValue(source, predicate, thisArg, yieldIndex) {
      var callback = bindCallback(predicate, thisArg, 3);
      return new AnonymousObservable(function(o) {
        var i = 0;
        return source.subscribe(function(x) {
          var shouldRun;
          try {
            shouldRun = callback(x, i, source);
          } catch (e) {
            o.onError(e);
            return ;
          }
          if (shouldRun) {
            o.onNext(yieldIndex ? i : x);
            o.onCompleted();
          } else {
            i++;
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onNext(yieldIndex ? -1 : undefined);
          o.onCompleted();
        });
      }, source);
    }
    observableProto.find = function(predicate, thisArg) {
      return findValue(this, predicate, thisArg, false);
    };
    observableProto.findIndex = function(predicate, thisArg) {
      return findValue(this, predicate, thisArg, true);
    };
    observableProto.toSet = function() {
      if (typeof root.Set === 'undefined') {
        throw new TypeError();
      }
      var source = this;
      return new AnonymousObservable(function(o) {
        var s = new root.Set();
        return source.subscribe(function(x) {
          s.add(x);
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onNext(s);
          o.onCompleted();
        });
      }, source);
    };
    observableProto.toMap = function(keySelector, elementSelector) {
      if (typeof root.Map === 'undefined') {
        throw new TypeError();
      }
      var source = this;
      return new AnonymousObservable(function(o) {
        var m = new root.Map();
        return source.subscribe(function(x) {
          var key;
          try {
            key = keySelector(x);
          } catch (e) {
            o.onError(e);
            return ;
          }
          var element = x;
          if (elementSelector) {
            try {
              element = elementSelector(x);
            } catch (e) {
              o.onError(e);
              return ;
            }
          }
          m.set(key, element);
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onNext(m);
          o.onCompleted();
        });
      }, source);
    };
    var fnString = 'function',
      throwString = 'throw',
      isObject = Rx.internals.isObject;
    function toThunk(obj, ctx) {
      if (Array.isArray(obj)) {
        return objectToThunk.call(ctx, obj);
      }
      if (isGeneratorFunction(obj)) {
        return observableSpawn(obj.call(ctx));
      }
      if (isGenerator(obj)) {
        return observableSpawn(obj);
      }
      if (isObservable(obj)) {
        return observableToThunk(obj);
      }
      if (isPromise(obj)) {
        return promiseToThunk(obj);
      }
      if (typeof obj === fnString) {
        return obj;
      }
      if (isObject(obj) || Array.isArray(obj)) {
        return objectToThunk.call(ctx, obj);
      }
      return obj;
    }
    function objectToThunk(obj) {
      var ctx = this;
      return function(done) {
        var keys = Object.keys(obj),
          pending = keys.length,
          results = new obj.constructor(),
          finished;
        if (!pending) {
          timeoutScheduler.schedule(function() {
            done(null, results);
          });
          return ;
        }
        for (var i = 0,
               len = keys.length; i < len; i++) {
          run(obj[keys[i]], keys[i]);
        }
        function run(fn, key) {
          if (finished) {
            return ;
          }
          try {
            fn = toThunk(fn, ctx);
            if (typeof fn !== fnString) {
              results[key] = fn;
              return --pending || done(null, results);
            }
            fn.call(ctx, function(err, res) {
              if (finished) {
                return ;
              }
              if (err) {
                finished = true;
                return done(err);
              }
              results[key] = res;
              --pending || done(null, results);
            });
          } catch (e) {
            finished = true;
            done(e);
          }
        }
      };
    }
    function observableToThunk(observable) {
      return function(fn) {
        var value,
          hasValue = false;
        observable.subscribe(function(v) {
          value = v;
          hasValue = true;
        }, fn, function() {
          hasValue && fn(null, value);
        });
      };
    }
    function promiseToThunk(promise) {
      return function(fn) {
        promise.then(function(res) {
          fn(null, res);
        }, fn);
      };
    }
    function isObservable(obj) {
      return obj && typeof obj.subscribe === fnString;
    }
    function isGeneratorFunction(obj) {
      return obj && obj.constructor && obj.constructor.name === 'GeneratorFunction';
    }
    function isGenerator(obj) {
      return obj && typeof obj.next === fnString && typeof obj[throwString] === fnString;
    }
    var observableSpawn = Rx.spawn = function(fn) {
      var isGenFun = isGeneratorFunction(fn);
      return function(done) {
        var ctx = this,
          gen = fn;
        if (isGenFun) {
          for (var args = [],
                 i = 0,
                 len = arguments.length; i < len; i++) {
            args.push(arguments[i]);
          }
          var len = args.length,
            hasCallback = len && typeof args[len - 1] === fnString;
          done = hasCallback ? args.pop() : handleError;
          gen = fn.apply(this, args);
        } else {
          done = done || handleError;
        }
        next();
        function exit(err, res) {
          timeoutScheduler.schedule(done.bind(ctx, err, res));
        }
        function next(err, res) {
          var ret;
          if (arguments.length > 2) {
            for (var res = [],
                   i = 1,
                   len = arguments.length; i < len; i++) {
              res.push(arguments[i]);
            }
          }
          if (err) {
            try {
              ret = gen[throwString](err);
            } catch (e) {
              return exit(e);
            }
          }
          if (!err) {
            try {
              ret = gen.next(res);
            } catch (e) {
              return exit(e);
            }
          }
          if (ret.done) {
            return exit(null, ret.value);
          }
          ret.value = toThunk(ret.value, ctx);
          if (typeof ret.value === fnString) {
            var called = false;
            try {
              ret.value.call(ctx, function() {
                if (called) {
                  return ;
                }
                called = true;
                next.apply(ctx, arguments);
              });
            } catch (e) {
              timeoutScheduler.schedule(function() {
                if (called) {
                  return ;
                }
                called = true;
                next.call(ctx, e);
              });
            }
            return ;
          }
          next(new TypeError('Rx.spawn only supports a function, Promise, Observable, Object or Array.'));
        }
      };
    };
    function handleError(err) {
      if (!err) {
        return ;
      }
      timeoutScheduler.schedule(function() {
        throw err;
      });
    }
    Observable.start = function(func, context, scheduler) {
      return observableToAsync(func, context, scheduler)();
    };
    var observableToAsync = Observable.toAsync = function(func, context, scheduler) {
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return function() {
        var args = arguments,
          subject = new AsyncSubject();
        scheduler.schedule(function() {
          var result;
          try {
            result = func.apply(context, args);
          } catch (e) {
            subject.onError(e);
            return ;
          }
          subject.onNext(result);
          subject.onCompleted();
        });
        return subject.asObservable();
      };
    };
    Observable.fromCallback = function(func, context, selector) {
      return function() {
        var len = arguments.length,
          args = new Array(len);
        for (var i = 0; i < len; i++) {
          args[i] = arguments[i];
        }
        return new AnonymousObservable(function(observer) {
          function handler() {
            var len = arguments.length,
              results = new Array(len);
            for (var i = 0; i < len; i++) {
              results[i] = arguments[i];
            }
            if (selector) {
              try {
                results = selector.apply(context, results);
              } catch (e) {
                return observer.onError(e);
              }
              observer.onNext(results);
            } else {
              if (results.length <= 1) {
                observer.onNext.apply(observer, results);
              } else {
                observer.onNext(results);
              }
            }
            observer.onCompleted();
          }
          args.push(handler);
          func.apply(context, args);
        }).publishLast().refCount();
      };
    };
    Observable.fromNodeCallback = function(func, context, selector) {
      return function() {
        var len = arguments.length,
          args = new Array(len);
        for (var i = 0; i < len; i++) {
          args[i] = arguments[i];
        }
        return new AnonymousObservable(function(observer) {
          function handler(err) {
            if (err) {
              observer.onError(err);
              return ;
            }
            var len = arguments.length,
              results = [];
            for (var i = 1; i < len; i++) {
              results[i - 1] = arguments[i];
            }
            if (selector) {
              try {
                results = selector.apply(context, results);
              } catch (e) {
                return observer.onError(e);
              }
              observer.onNext(results);
            } else {
              if (results.length <= 1) {
                observer.onNext.apply(observer, results);
              } else {
                observer.onNext(results);
              }
            }
            observer.onCompleted();
          }
          args.push(handler);
          func.apply(context, args);
        }).publishLast().refCount();
      };
    };
    function createListener(element, name, handler) {
      if (element.addEventListener) {
        element.addEventListener(name, handler, false);
        return disposableCreate(function() {
          element.removeEventListener(name, handler, false);
        });
      }
      throw new Error('No listener found');
    }
    function createEventListener(el, eventName, handler) {
      var disposables = new CompositeDisposable();
      if (Object.prototype.toString.call(el) === '[object NodeList]') {
        for (var i = 0,
               len = el.length; i < len; i++) {
          disposables.add(createEventListener(el.item(i), eventName, handler));
        }
      } else if (el) {
        disposables.add(createListener(el, eventName, handler));
      }
      return disposables;
    }
    Rx.config.useNativeEvents = false;
    Observable.fromEvent = function(element, eventName, selector) {
      if (element.addListener) {
        return fromEventPattern(function(h) {
          element.addListener(eventName, h);
        }, function(h) {
          element.removeListener(eventName, h);
        }, selector);
      }
      if (!Rx.config.useNativeEvents) {
        if (typeof element.on === 'function' && typeof element.off === 'function') {
          return fromEventPattern(function(h) {
            element.on(eventName, h);
          }, function(h) {
            element.off(eventName, h);
          }, selector);
        }
      }
      return new AnonymousObservable(function(observer) {
        return createEventListener(element, eventName, function handler(e) {
          var results = e;
          if (selector) {
            try {
              results = selector(arguments);
            } catch (err) {
              return observer.onError(err);
            }
          }
          observer.onNext(results);
        });
      }).publish().refCount();
    };
    var fromEventPattern = Observable.fromEventPattern = function(addHandler, removeHandler, selector) {
      return new AnonymousObservable(function(observer) {
        function innerHandler(e) {
          var result = e;
          if (selector) {
            try {
              result = selector(arguments);
            } catch (err) {
              return observer.onError(err);
            }
          }
          observer.onNext(result);
        }
        var returnValue = addHandler(innerHandler);
        return disposableCreate(function() {
          if (removeHandler) {
            removeHandler(innerHandler, returnValue);
          }
        });
      }).publish().refCount();
    };
    Observable.startAsync = function(functionAsync) {
      var promise;
      try {
        promise = functionAsync();
      } catch (e) {
        return observableThrow(e);
      }
      return observableFromPromise(promise);
    };
    var PausableObservable = (function(__super__) {
      inherits(PausableObservable, __super__);
      function subscribe(observer) {
        var conn = this.source.publish(),
          subscription = conn.subscribe(observer),
          connection = disposableEmpty;
        var pausable = this.pauser.distinctUntilChanged().subscribe(function(b) {
          if (b) {
            connection = conn.connect();
          } else {
            connection.dispose();
            connection = disposableEmpty;
          }
        });
        return new CompositeDisposable(subscription, connection, pausable);
      }
      function PausableObservable(source, pauser) {
        this.source = source;
        this.controller = new Subject();
        if (pauser && pauser.subscribe) {
          this.pauser = this.controller.merge(pauser);
        } else {
          this.pauser = this.controller;
        }
        __super__.call(this, subscribe, source);
      }
      PausableObservable.prototype.pause = function() {
        this.controller.onNext(false);
      };
      PausableObservable.prototype.resume = function() {
        this.controller.onNext(true);
      };
      return PausableObservable;
    }(Observable));
    observableProto.pausable = function(pauser) {
      return new PausableObservable(this, pauser);
    };
    function combineLatestSource(source, subject, resultSelector) {
      return new AnonymousObservable(function(o) {
        var hasValue = [false, false],
          hasValueAll = false,
          isDone = false,
          values = new Array(2),
          err;
        function next(x, i) {
          values[i] = x;
          var res;
          hasValue[i] = true;
          if (hasValueAll || (hasValueAll = hasValue.every(identity))) {
            if (err) {
              o.onError(err);
              return ;
            }
            try {
              res = resultSelector.apply(null, values);
            } catch (ex) {
              o.onError(ex);
              return ;
            }
            o.onNext(res);
          }
          if (isDone && values[1]) {
            o.onCompleted();
          }
        }
        return new CompositeDisposable(source.subscribe(function(x) {
          next(x, 0);
        }, function(e) {
          if (values[1]) {
            o.onError(e);
          } else {
            err = e;
          }
        }, function() {
          isDone = true;
          values[1] && o.onCompleted();
        }), subject.subscribe(function(x) {
          next(x, 1);
        }, function(e) {
          o.onError(e);
        }, function() {
          isDone = true;
          next(true, 1);
        }));
      }, source);
    }
    var PausableBufferedObservable = (function(__super__) {
      inherits(PausableBufferedObservable, __super__);
      function subscribe(o) {
        var q = [],
          previousShouldFire;
        var subscription = combineLatestSource(this.source, this.pauser.distinctUntilChanged().startWith(false), function(data, shouldFire) {
          return {
            data: data,
            shouldFire: shouldFire
          };
        }).subscribe(function(results) {
          if (previousShouldFire !== undefined && results.shouldFire != previousShouldFire) {
            previousShouldFire = results.shouldFire;
            if (results.shouldFire) {
              while (q.length > 0) {
                o.onNext(q.shift());
              }
            }
          } else {
            previousShouldFire = results.shouldFire;
            if (results.shouldFire) {
              o.onNext(results.data);
            } else {
              q.push(results.data);
            }
          }
        }, function(err) {
          while (q.length > 0) {
            o.onNext(q.shift());
          }
          o.onError(err);
        }, function() {
          while (q.length > 0) {
            o.onNext(q.shift());
          }
          o.onCompleted();
        });
        return subscription;
      }
      function PausableBufferedObservable(source, pauser) {
        this.source = source;
        this.controller = new Subject();
        if (pauser && pauser.subscribe) {
          this.pauser = this.controller.merge(pauser);
        } else {
          this.pauser = this.controller;
        }
        __super__.call(this, subscribe, source);
      }
      PausableBufferedObservable.prototype.pause = function() {
        this.controller.onNext(false);
      };
      PausableBufferedObservable.prototype.resume = function() {
        this.controller.onNext(true);
      };
      return PausableBufferedObservable;
    }(Observable));
    observableProto.pausableBuffered = function(subject) {
      return new PausableBufferedObservable(this, subject);
    };
    var ControlledObservable = (function(__super__) {
      inherits(ControlledObservable, __super__);
      function subscribe(observer) {
        return this.source.subscribe(observer);
      }
      function ControlledObservable(source, enableQueue) {
        __super__.call(this, subscribe, source);
        this.subject = new ControlledSubject(enableQueue);
        this.source = source.multicast(this.subject).refCount();
      }
      ControlledObservable.prototype.request = function(numberOfItems) {
        if (numberOfItems == null) {
          numberOfItems = -1;
        }
        return this.subject.request(numberOfItems);
      };
      return ControlledObservable;
    }(Observable));
    var ControlledSubject = (function(__super__) {
      function subscribe(observer) {
        return this.subject.subscribe(observer);
      }
      inherits(ControlledSubject, __super__);
      function ControlledSubject(enableQueue) {
        enableQueue == null && (enableQueue = true);
        __super__.call(this, subscribe);
        this.subject = new Subject();
        this.enableQueue = enableQueue;
        this.queue = enableQueue ? [] : null;
        this.requestedCount = 0;
        this.requestedDisposable = disposableEmpty;
        this.error = null;
        this.hasFailed = false;
        this.hasCompleted = false;
      }
      addProperties(ControlledSubject.prototype, Observer, {
        onCompleted: function() {
          this.hasCompleted = true;
          if (!this.enableQueue || this.queue.length === 0)
            this.subject.onCompleted();
          else
            this.queue.push(Rx.Notification.createOnCompleted());
        },
        onError: function(error) {
          this.hasFailed = true;
          this.error = error;
          if (!this.enableQueue || this.queue.length === 0)
            this.subject.onError(error);
          else
            this.queue.push(Rx.Notification.createOnError(error));
        },
        onNext: function(value) {
          var hasRequested = false;
          if (this.requestedCount === 0) {
            this.enableQueue && this.queue.push(Rx.Notification.createOnNext(value));
          } else {
            (this.requestedCount !== -1 && this.requestedCount-- === 0) && this.disposeCurrentRequest();
            hasRequested = true;
          }
          hasRequested && this.subject.onNext(value);
        },
        _processRequest: function(numberOfItems) {
          if (this.enableQueue) {
            while ((this.queue.length >= numberOfItems && numberOfItems > 0) || (this.queue.length > 0 && this.queue[0].kind !== 'N')) {
              var first = this.queue.shift();
              first.accept(this.subject);
              if (first.kind === 'N')
                numberOfItems--;
              else {
                this.disposeCurrentRequest();
                this.queue = [];
              }
            }
            return {
              numberOfItems: numberOfItems,
              returnValue: this.queue.length !== 0
            };
          }
          return {
            numberOfItems: numberOfItems,
            returnValue: false
          };
        },
        request: function(number) {
          this.disposeCurrentRequest();
          var self = this,
            r = this._processRequest(number);
          var number = r.numberOfItems;
          if (!r.returnValue) {
            this.requestedCount = number;
            this.requestedDisposable = disposableCreate(function() {
              self.requestedCount = 0;
            });
            return this.requestedDisposable;
          } else {
            return disposableEmpty;
          }
        },
        disposeCurrentRequest: function() {
          this.requestedDisposable.dispose();
          this.requestedDisposable = disposableEmpty;
        }
      });
      return ControlledSubject;
    }(Observable));
    observableProto.controlled = function(enableQueue) {
      if (enableQueue == null) {
        enableQueue = true;
      }
      return new ControlledObservable(this, enableQueue);
    };
    var StopAndWaitObservable = (function(__super__) {
      function subscribe(observer) {
        this.subscription = this.source.subscribe(new StopAndWaitObserver(observer, this, this.subscription));
        var self = this;
        timeoutScheduler.schedule(function() {
          self.source.request(1);
        });
        return this.subscription;
      }
      inherits(StopAndWaitObservable, __super__);
      function StopAndWaitObservable(source) {
        __super__.call(this, subscribe, source);
        this.source = source;
      }
      var StopAndWaitObserver = (function(__sub__) {
        inherits(StopAndWaitObserver, __sub__);
        function StopAndWaitObserver(observer, observable, cancel) {
          __sub__.call(this);
          this.observer = observer;
          this.observable = observable;
          this.cancel = cancel;
        }
        var stopAndWaitObserverProto = StopAndWaitObserver.prototype;
        stopAndWaitObserverProto.completed = function() {
          this.observer.onCompleted();
          this.dispose();
        };
        stopAndWaitObserverProto.error = function(error) {
          this.observer.onError(error);
          this.dispose();
        };
        stopAndWaitObserverProto.next = function(value) {
          this.observer.onNext(value);
          var self = this;
          timeoutScheduler.schedule(function() {
            self.observable.source.request(1);
          });
        };
        stopAndWaitObserverProto.dispose = function() {
          this.observer = null;
          if (this.cancel) {
            this.cancel.dispose();
            this.cancel = null;
          }
          __sub__.prototype.dispose.call(this);
        };
        return StopAndWaitObserver;
      }(AbstractObserver));
      return StopAndWaitObservable;
    }(Observable));
    ControlledObservable.prototype.stopAndWait = function() {
      return new StopAndWaitObservable(this);
    };
    var WindowedObservable = (function(__super__) {
      function subscribe(observer) {
        this.subscription = this.source.subscribe(new WindowedObserver(observer, this, this.subscription));
        var self = this;
        timeoutScheduler.schedule(function() {
          self.source.request(self.windowSize);
        });
        return this.subscription;
      }
      inherits(WindowedObservable, __super__);
      function WindowedObservable(source, windowSize) {
        __super__.call(this, subscribe, source);
        this.source = source;
        this.windowSize = windowSize;
      }
      var WindowedObserver = (function(__sub__) {
        inherits(WindowedObserver, __sub__);
        function WindowedObserver(observer, observable, cancel) {
          this.observer = observer;
          this.observable = observable;
          this.cancel = cancel;
          this.received = 0;
        }
        var windowedObserverPrototype = WindowedObserver.prototype;
        windowedObserverPrototype.completed = function() {
          this.observer.onCompleted();
          this.dispose();
        };
        windowedObserverPrototype.error = function(error) {
          this.observer.onError(error);
          this.dispose();
        };
        windowedObserverPrototype.next = function(value) {
          this.observer.onNext(value);
          this.received = ++this.received % this.observable.windowSize;
          if (this.received === 0) {
            var self = this;
            timeoutScheduler.schedule(function() {
              self.observable.source.request(self.observable.windowSize);
            });
          }
        };
        windowedObserverPrototype.dispose = function() {
          this.observer = null;
          if (this.cancel) {
            this.cancel.dispose();
            this.cancel = null;
          }
          __sub__.prototype.dispose.call(this);
        };
        return WindowedObserver;
      }(AbstractObserver));
      return WindowedObservable;
    }(Observable));
    ControlledObservable.prototype.windowed = function(windowSize) {
      return new WindowedObservable(this, windowSize);
    };
    observableProto.pipe = function(dest) {
      var source = this.pausableBuffered();
      function onDrain() {
        source.resume();
      }
      dest.addListener('drain', onDrain);
      source.subscribe(function(x) {
        !dest.write(String(x)) && source.pause();
      }, function(err) {
        dest.emit('error', err);
      }, function() {
        !dest._isStdio && dest.end();
        dest.removeListener('drain', onDrain);
      });
      source.resume();
      return dest;
    };
    observableProto.multicast = function(subjectOrSubjectSelector, selector) {
      var source = this;
      return typeof subjectOrSubjectSelector === 'function' ? new AnonymousObservable(function(observer) {
        var connectable = source.multicast(subjectOrSubjectSelector());
        return new CompositeDisposable(selector(connectable).subscribe(observer), connectable.connect());
      }, source) : new ConnectableObservable(source, subjectOrSubjectSelector);
    };
    observableProto.publish = function(selector) {
      return selector && isFunction(selector) ? this.multicast(function() {
        return new Subject();
      }, selector) : this.multicast(new Subject());
    };
    observableProto.share = function() {
      return this.publish().refCount();
    };
    observableProto.publishLast = function(selector) {
      return selector && isFunction(selector) ? this.multicast(function() {
        return new AsyncSubject();
      }, selector) : this.multicast(new AsyncSubject());
    };
    observableProto.publishValue = function(initialValueOrSelector, initialValue) {
      return arguments.length === 2 ? this.multicast(function() {
        return new BehaviorSubject(initialValue);
      }, initialValueOrSelector) : this.multicast(new BehaviorSubject(initialValueOrSelector));
    };
    observableProto.shareValue = function(initialValue) {
      return this.publishValue(initialValue).refCount();
    };
    observableProto.replay = function(selector, bufferSize, windowSize, scheduler) {
      return selector && isFunction(selector) ? this.multicast(function() {
        return new ReplaySubject(bufferSize, windowSize, scheduler);
      }, selector) : this.multicast(new ReplaySubject(bufferSize, windowSize, scheduler));
    };
    observableProto.shareReplay = function(bufferSize, windowSize, scheduler) {
      return this.replay(null, bufferSize, windowSize, scheduler).refCount();
    };
    var InnerSubscription = function(subject, observer) {
      this.subject = subject;
      this.observer = observer;
    };
    InnerSubscription.prototype.dispose = function() {
      if (!this.subject.isDisposed && this.observer !== null) {
        var idx = this.subject.observers.indexOf(this.observer);
        this.subject.observers.splice(idx, 1);
        this.observer = null;
      }
    };
    var BehaviorSubject = Rx.BehaviorSubject = (function(__super__) {
      function subscribe(observer) {
        checkDisposed(this);
        if (!this.isStopped) {
          this.observers.push(observer);
          observer.onNext(this.value);
          return new InnerSubscription(this, observer);
        }
        if (this.hasError) {
          observer.onError(this.error);
        } else {
          observer.onCompleted();
        }
        return disposableEmpty;
      }
      inherits(BehaviorSubject, __super__);
      function BehaviorSubject(value) {
        __super__.call(this, subscribe);
        this.value = value, this.observers = [], this.isDisposed = false, this.isStopped = false, this.hasError = false;
      }
      addProperties(BehaviorSubject.prototype, Observer, {
        getValue: function() {
          checkDisposed(this);
          if (this.hasError) {
            throw this.error;
          }
          return this.value;
        },
        hasObservers: function() {
          return this.observers.length > 0;
        },
        onCompleted: function() {
          checkDisposed(this);
          if (this.isStopped) {
            return ;
          }
          this.isStopped = true;
          for (var i = 0,
                 os = cloneArray(this.observers),
                 len = os.length; i < len; i++) {
            os[i].onCompleted();
          }
          this.observers.length = 0;
        },
        onError: function(error) {
          checkDisposed(this);
          if (this.isStopped) {
            return ;
          }
          this.isStopped = true;
          this.hasError = true;
          this.error = error;
          for (var i = 0,
                 os = cloneArray(this.observers),
                 len = os.length; i < len; i++) {
            os[i].onError(error);
          }
          this.observers.length = 0;
        },
        onNext: function(value) {
          checkDisposed(this);
          if (this.isStopped) {
            return ;
          }
          this.value = value;
          for (var i = 0,
                 os = cloneArray(this.observers),
                 len = os.length; i < len; i++) {
            os[i].onNext(value);
          }
        },
        dispose: function() {
          this.isDisposed = true;
          this.observers = null;
          this.value = null;
          this.exception = null;
        }
      });
      return BehaviorSubject;
    }(Observable));
    var ReplaySubject = Rx.ReplaySubject = (function(__super__) {
      var maxSafeInteger = Math.pow(2, 53) - 1;
      function createRemovableDisposable(subject, observer) {
        return disposableCreate(function() {
          observer.dispose();
          !subject.isDisposed && subject.observers.splice(subject.observers.indexOf(observer), 1);
        });
      }
      function subscribe(observer) {
        var so = new ScheduledObserver(this.scheduler, observer),
          subscription = createRemovableDisposable(this, so);
        checkDisposed(this);
        this._trim(this.scheduler.now());
        this.observers.push(so);
        for (var i = 0,
               len = this.q.length; i < len; i++) {
          so.onNext(this.q[i].value);
        }
        if (this.hasError) {
          so.onError(this.error);
        } else if (this.isStopped) {
          so.onCompleted();
        }
        so.ensureActive();
        return subscription;
      }
      inherits(ReplaySubject, __super__);
      function ReplaySubject(bufferSize, windowSize, scheduler) {
        this.bufferSize = bufferSize == null ? maxSafeInteger : bufferSize;
        this.windowSize = windowSize == null ? maxSafeInteger : windowSize;
        this.scheduler = scheduler || currentThreadScheduler;
        this.q = [];
        this.observers = [];
        this.isStopped = false;
        this.isDisposed = false;
        this.hasError = false;
        this.error = null;
        __super__.call(this, subscribe);
      }
      addProperties(ReplaySubject.prototype, Observer.prototype, {
        hasObservers: function() {
          return this.observers.length > 0;
        },
        _trim: function(now) {
          while (this.q.length > this.bufferSize) {
            this.q.shift();
          }
          while (this.q.length > 0 && (now - this.q[0].interval) > this.windowSize) {
            this.q.shift();
          }
        },
        onNext: function(value) {
          checkDisposed(this);
          if (this.isStopped) {
            return ;
          }
          var now = this.scheduler.now();
          this.q.push({
            interval: now,
            value: value
          });
          this._trim(now);
          for (var i = 0,
                 os = cloneArray(this.observers),
                 len = os.length; i < len; i++) {
            var observer = os[i];
            observer.onNext(value);
            observer.ensureActive();
          }
        },
        onError: function(error) {
          checkDisposed(this);
          if (this.isStopped) {
            return ;
          }
          this.isStopped = true;
          this.error = error;
          this.hasError = true;
          var now = this.scheduler.now();
          this._trim(now);
          for (var i = 0,
                 os = cloneArray(this.observers),
                 len = os.length; i < len; i++) {
            var observer = os[i];
            observer.onError(error);
            observer.ensureActive();
          }
          this.observers.length = 0;
        },
        onCompleted: function() {
          checkDisposed(this);
          if (this.isStopped) {
            return ;
          }
          this.isStopped = true;
          var now = this.scheduler.now();
          this._trim(now);
          for (var i = 0,
                 os = cloneArray(this.observers),
                 len = os.length; i < len; i++) {
            var observer = os[i];
            observer.onCompleted();
            observer.ensureActive();
          }
          this.observers.length = 0;
        },
        dispose: function() {
          this.isDisposed = true;
          this.observers = null;
        }
      });
      return ReplaySubject;
    }(Observable));
    var ConnectableObservable = Rx.ConnectableObservable = (function(__super__) {
      inherits(ConnectableObservable, __super__);
      function ConnectableObservable(source, subject) {
        var hasSubscription = false,
          subscription,
          sourceObservable = source.asObservable();
        this.connect = function() {
          if (!hasSubscription) {
            hasSubscription = true;
            subscription = new CompositeDisposable(sourceObservable.subscribe(subject), disposableCreate(function() {
              hasSubscription = false;
            }));
          }
          return subscription;
        };
        __super__.call(this, function(o) {
          return subject.subscribe(o);
        });
      }
      ConnectableObservable.prototype.refCount = function() {
        var connectableSubscription,
          count = 0,
          source = this;
        return new AnonymousObservable(function(observer) {
          var shouldConnect = ++count === 1,
            subscription = source.subscribe(observer);
          shouldConnect && (connectableSubscription = source.connect());
          return function() {
            subscription.dispose();
            --count === 0 && connectableSubscription.dispose();
          };
        });
      };
      return ConnectableObservable;
    }(Observable));
    var Dictionary = (function() {
      var primes = [1, 3, 7, 13, 31, 61, 127, 251, 509, 1021, 2039, 4093, 8191, 16381, 32749, 65521, 131071, 262139, 524287, 1048573, 2097143, 4194301, 8388593, 16777213, 33554393, 67108859, 134217689, 268435399, 536870909, 1073741789, 2147483647],
        noSuchkey = "no such key",
        duplicatekey = "duplicate key";
      function isPrime(candidate) {
        if ((candidate & 1) === 0) {
          return candidate === 2;
        }
        var num1 = Math.sqrt(candidate),
          num2 = 3;
        while (num2 <= num1) {
          if (candidate % num2 === 0) {
            return false;
          }
          num2 += 2;
        }
        return true;
      }
      function getPrime(min) {
        var index,
          num,
          candidate;
        for (index = 0; index < primes.length; ++index) {
          num = primes[index];
          if (num >= min) {
            return num;
          }
        }
        candidate = min | 1;
        while (candidate < primes[primes.length - 1]) {
          if (isPrime(candidate)) {
            return candidate;
          }
          candidate += 2;
        }
        return min;
      }
      function stringHashFn(str) {
        var hash = 757602046;
        if (!str.length) {
          return hash;
        }
        for (var i = 0,
               len = str.length; i < len; i++) {
          var character = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + character;
          hash = hash & hash;
        }
        return hash;
      }
      function numberHashFn(key) {
        var c2 = 0x27d4eb2d;
        key = (key ^ 61) ^ (key >>> 16);
        key = key + (key << 3);
        key = key ^ (key >>> 4);
        key = key * c2;
        key = key ^ (key >>> 15);
        return key;
      }
      var getHashCode = (function() {
        var uniqueIdCounter = 0;
        return function(obj) {
          if (obj == null) {
            throw new Error(noSuchkey);
          }
          if (typeof obj === 'string') {
            return stringHashFn(obj);
          }
          if (typeof obj === 'number') {
            return numberHashFn(obj);
          }
          if (typeof obj === 'boolean') {
            return obj === true ? 1 : 0;
          }
          if (obj instanceof Date) {
            return numberHashFn(obj.valueOf());
          }
          if (obj instanceof RegExp) {
            return stringHashFn(obj.toString());
          }
          if (typeof obj.valueOf === 'function') {
            var valueOf = obj.valueOf();
            if (typeof valueOf === 'number') {
              return numberHashFn(valueOf);
            }
            if (typeof valueOf === 'string') {
              return stringHashFn(valueOf);
            }
          }
          if (obj.hashCode) {
            return obj.hashCode();
          }
          var id = 17 * uniqueIdCounter++;
          obj.hashCode = function() {
            return id;
          };
          return id;
        };
      }());
      function newEntry() {
        return {
          key: null,
          value: null,
          next: 0,
          hashCode: 0
        };
      }
      function Dictionary(capacity, comparer) {
        if (capacity < 0) {
          throw new ArgumentOutOfRangeError();
        }
        if (capacity > 0) {
          this._initialize(capacity);
        }
        this.comparer = comparer || defaultComparer;
        this.freeCount = 0;
        this.size = 0;
        this.freeList = -1;
      }
      var dictionaryProto = Dictionary.prototype;
      dictionaryProto._initialize = function(capacity) {
        var prime = getPrime(capacity),
          i;
        this.buckets = new Array(prime);
        this.entries = new Array(prime);
        for (i = 0; i < prime; i++) {
          this.buckets[i] = -1;
          this.entries[i] = newEntry();
        }
        this.freeList = -1;
      };
      dictionaryProto.add = function(key, value) {
        this._insert(key, value, true);
      };
      dictionaryProto._insert = function(key, value, add) {
        if (!this.buckets) {
          this._initialize(0);
        }
        var index3,
          num = getHashCode(key) & 2147483647,
          index1 = num % this.buckets.length;
        for (var index2 = this.buckets[index1]; index2 >= 0; index2 = this.entries[index2].next) {
          if (this.entries[index2].hashCode === num && this.comparer(this.entries[index2].key, key)) {
            if (add) {
              throw new Error(duplicatekey);
            }
            this.entries[index2].value = value;
            return ;
          }
        }
        if (this.freeCount > 0) {
          index3 = this.freeList;
          this.freeList = this.entries[index3].next;
          --this.freeCount;
        } else {
          if (this.size === this.entries.length) {
            this._resize();
            index1 = num % this.buckets.length;
          }
          index3 = this.size;
          ++this.size;
        }
        this.entries[index3].hashCode = num;
        this.entries[index3].next = this.buckets[index1];
        this.entries[index3].key = key;
        this.entries[index3].value = value;
        this.buckets[index1] = index3;
      };
      dictionaryProto._resize = function() {
        var prime = getPrime(this.size * 2),
          numArray = new Array(prime);
        for (index = 0; index < numArray.length; ++index) {
          numArray[index] = -1;
        }
        var entryArray = new Array(prime);
        for (index = 0; index < this.size; ++index) {
          entryArray[index] = this.entries[index];
        }
        for (var index = this.size; index < prime; ++index) {
          entryArray[index] = newEntry();
        }
        for (var index1 = 0; index1 < this.size; ++index1) {
          var index2 = entryArray[index1].hashCode % prime;
          entryArray[index1].next = numArray[index2];
          numArray[index2] = index1;
        }
        this.buckets = numArray;
        this.entries = entryArray;
      };
      dictionaryProto.remove = function(key) {
        if (this.buckets) {
          var num = getHashCode(key) & 2147483647,
            index1 = num % this.buckets.length,
            index2 = -1;
          for (var index3 = this.buckets[index1]; index3 >= 0; index3 = this.entries[index3].next) {
            if (this.entries[index3].hashCode === num && this.comparer(this.entries[index3].key, key)) {
              if (index2 < 0) {
                this.buckets[index1] = this.entries[index3].next;
              } else {
                this.entries[index2].next = this.entries[index3].next;
              }
              this.entries[index3].hashCode = -1;
              this.entries[index3].next = this.freeList;
              this.entries[index3].key = null;
              this.entries[index3].value = null;
              this.freeList = index3;
              ++this.freeCount;
              return true;
            } else {
              index2 = index3;
            }
          }
        }
        return false;
      };
      dictionaryProto.clear = function() {
        var index,
          len;
        if (this.size <= 0) {
          return ;
        }
        for (index = 0, len = this.buckets.length; index < len; ++index) {
          this.buckets[index] = -1;
        }
        for (index = 0; index < this.size; ++index) {
          this.entries[index] = newEntry();
        }
        this.freeList = -1;
        this.size = 0;
      };
      dictionaryProto._findEntry = function(key) {
        if (this.buckets) {
          var num = getHashCode(key) & 2147483647;
          for (var index = this.buckets[num % this.buckets.length]; index >= 0; index = this.entries[index].next) {
            if (this.entries[index].hashCode === num && this.comparer(this.entries[index].key, key)) {
              return index;
            }
          }
        }
        return -1;
      };
      dictionaryProto.count = function() {
        return this.size - this.freeCount;
      };
      dictionaryProto.tryGetValue = function(key) {
        var entry = this._findEntry(key);
        return entry >= 0 ? this.entries[entry].value : undefined;
      };
      dictionaryProto.getValues = function() {
        var index = 0,
          results = [];
        if (this.entries) {
          for (var index1 = 0; index1 < this.size; index1++) {
            if (this.entries[index1].hashCode >= 0) {
              results[index++] = this.entries[index1].value;
            }
          }
        }
        return results;
      };
      dictionaryProto.get = function(key) {
        var entry = this._findEntry(key);
        if (entry >= 0) {
          return this.entries[entry].value;
        }
        throw new Error(noSuchkey);
      };
      dictionaryProto.set = function(key, value) {
        this._insert(key, value, false);
      };
      dictionaryProto.containskey = function(key) {
        return this._findEntry(key) >= 0;
      };
      return Dictionary;
    }());
    observableProto.join = function(right, leftDurationSelector, rightDurationSelector, resultSelector) {
      var left = this;
      return new AnonymousObservable(function(observer) {
        var group = new CompositeDisposable();
        var leftDone = false,
          rightDone = false;
        var leftId = 0,
          rightId = 0;
        var leftMap = new Dictionary(),
          rightMap = new Dictionary();
        group.add(left.subscribe(function(value) {
          var id = leftId++;
          var md = new SingleAssignmentDisposable();
          leftMap.add(id, value);
          group.add(md);
          var expire = function() {
            leftMap.remove(id) && leftMap.count() === 0 && leftDone && observer.onCompleted();
            group.remove(md);
          };
          var duration;
          try {
            duration = leftDurationSelector(value);
          } catch (e) {
            observer.onError(e);
            return ;
          }
          md.setDisposable(duration.take(1).subscribe(noop, observer.onError.bind(observer), expire));
          rightMap.getValues().forEach(function(v) {
            var result;
            try {
              result = resultSelector(value, v);
            } catch (exn) {
              observer.onError(exn);
              return ;
            }
            observer.onNext(result);
          });
        }, observer.onError.bind(observer), function() {
          leftDone = true;
          (rightDone || leftMap.count() === 0) && observer.onCompleted();
        }));
        group.add(right.subscribe(function(value) {
          var id = rightId++;
          var md = new SingleAssignmentDisposable();
          rightMap.add(id, value);
          group.add(md);
          var expire = function() {
            rightMap.remove(id) && rightMap.count() === 0 && rightDone && observer.onCompleted();
            group.remove(md);
          };
          var duration;
          try {
            duration = rightDurationSelector(value);
          } catch (e) {
            observer.onError(e);
            return ;
          }
          md.setDisposable(duration.take(1).subscribe(noop, observer.onError.bind(observer), expire));
          leftMap.getValues().forEach(function(v) {
            var result;
            try {
              result = resultSelector(v, value);
            } catch (exn) {
              observer.onError(exn);
              return ;
            }
            observer.onNext(result);
          });
        }, observer.onError.bind(observer), function() {
          rightDone = true;
          (leftDone || rightMap.count() === 0) && observer.onCompleted();
        }));
        return group;
      }, left);
    };
    observableProto.groupJoin = function(right, leftDurationSelector, rightDurationSelector, resultSelector) {
      var left = this;
      return new AnonymousObservable(function(observer) {
        var group = new CompositeDisposable();
        var r = new RefCountDisposable(group);
        var leftMap = new Dictionary(),
          rightMap = new Dictionary();
        var leftId = 0,
          rightId = 0;
        function handleError(e) {
          return function(v) {
            v.onError(e);
          };
        }
        ;
        group.add(left.subscribe(function(value) {
          var s = new Subject();
          var id = leftId++;
          leftMap.add(id, s);
          var result;
          try {
            result = resultSelector(value, addRef(s, r));
          } catch (e) {
            leftMap.getValues().forEach(handleError(e));
            observer.onError(e);
            return ;
          }
          observer.onNext(result);
          rightMap.getValues().forEach(function(v) {
            s.onNext(v);
          });
          var md = new SingleAssignmentDisposable();
          group.add(md);
          var expire = function() {
            leftMap.remove(id) && s.onCompleted();
            group.remove(md);
          };
          var duration;
          try {
            duration = leftDurationSelector(value);
          } catch (e) {
            leftMap.getValues().forEach(handleError(e));
            observer.onError(e);
            return ;
          }
          md.setDisposable(duration.take(1).subscribe(noop, function(e) {
            leftMap.getValues().forEach(handleError(e));
            observer.onError(e);
          }, expire));
        }, function(e) {
          leftMap.getValues().forEach(handleError(e));
          observer.onError(e);
        }, observer.onCompleted.bind(observer)));
        group.add(right.subscribe(function(value) {
          var id = rightId++;
          rightMap.add(id, value);
          var md = new SingleAssignmentDisposable();
          group.add(md);
          var expire = function() {
            rightMap.remove(id);
            group.remove(md);
          };
          var duration;
          try {
            duration = rightDurationSelector(value);
          } catch (e) {
            leftMap.getValues().forEach(handleError(e));
            observer.onError(e);
            return ;
          }
          md.setDisposable(duration.take(1).subscribe(noop, function(e) {
            leftMap.getValues().forEach(handleError(e));
            observer.onError(e);
          }, expire));
          leftMap.getValues().forEach(function(v) {
            v.onNext(value);
          });
        }, function(e) {
          leftMap.getValues().forEach(handleError(e));
          observer.onError(e);
        }));
        return r;
      }, left);
    };
    observableProto.buffer = function(bufferOpeningsOrClosingSelector, bufferClosingSelector) {
      return this.window.apply(this, arguments).selectMany(function(x) {
        return x.toArray();
      });
    };
    observableProto.window = function(windowOpeningsOrClosingSelector, windowClosingSelector) {
      if (arguments.length === 1 && typeof arguments[0] !== 'function') {
        return observableWindowWithBoundaries.call(this, windowOpeningsOrClosingSelector);
      }
      return typeof windowOpeningsOrClosingSelector === 'function' ? observableWindowWithClosingSelector.call(this, windowOpeningsOrClosingSelector) : observableWindowWithOpenings.call(this, windowOpeningsOrClosingSelector, windowClosingSelector);
    };
    function observableWindowWithOpenings(windowOpenings, windowClosingSelector) {
      return windowOpenings.groupJoin(this, windowClosingSelector, observableEmpty, function(_, win) {
        return win;
      });
    }
    function observableWindowWithBoundaries(windowBoundaries) {
      var source = this;
      return new AnonymousObservable(function(observer) {
        var win = new Subject(),
          d = new CompositeDisposable(),
          r = new RefCountDisposable(d);
        observer.onNext(addRef(win, r));
        d.add(source.subscribe(function(x) {
          win.onNext(x);
        }, function(err) {
          win.onError(err);
          observer.onError(err);
        }, function() {
          win.onCompleted();
          observer.onCompleted();
        }));
        isPromise(windowBoundaries) && (windowBoundaries = observableFromPromise(windowBoundaries));
        d.add(windowBoundaries.subscribe(function(w) {
          win.onCompleted();
          win = new Subject();
          observer.onNext(addRef(win, r));
        }, function(err) {
          win.onError(err);
          observer.onError(err);
        }, function() {
          win.onCompleted();
          observer.onCompleted();
        }));
        return r;
      }, source);
    }
    function observableWindowWithClosingSelector(windowClosingSelector) {
      var source = this;
      return new AnonymousObservable(function(observer) {
        var m = new SerialDisposable(),
          d = new CompositeDisposable(m),
          r = new RefCountDisposable(d),
          win = new Subject();
        observer.onNext(addRef(win, r));
        d.add(source.subscribe(function(x) {
          win.onNext(x);
        }, function(err) {
          win.onError(err);
          observer.onError(err);
        }, function() {
          win.onCompleted();
          observer.onCompleted();
        }));
        function createWindowClose() {
          var windowClose;
          try {
            windowClose = windowClosingSelector();
          } catch (e) {
            observer.onError(e);
            return ;
          }
          isPromise(windowClose) && (windowClose = observableFromPromise(windowClose));
          var m1 = new SingleAssignmentDisposable();
          m.setDisposable(m1);
          m1.setDisposable(windowClose.take(1).subscribe(noop, function(err) {
            win.onError(err);
            observer.onError(err);
          }, function() {
            win.onCompleted();
            win = new Subject();
            observer.onNext(addRef(win, r));
            createWindowClose();
          }));
        }
        createWindowClose();
        return r;
      }, source);
    }
    observableProto.pairwise = function() {
      var source = this;
      return new AnonymousObservable(function(observer) {
        var previous,
          hasPrevious = false;
        return source.subscribe(function(x) {
          if (hasPrevious) {
            observer.onNext([previous, x]);
          } else {
            hasPrevious = true;
          }
          previous = x;
        }, observer.onError.bind(observer), observer.onCompleted.bind(observer));
      }, source);
    };
    observableProto.partition = function(predicate, thisArg) {
      return [this.filter(predicate, thisArg), this.filter(function(x, i, o) {
        return !predicate.call(thisArg, x, i, o);
      })];
    };
    function enumerableWhile(condition, source) {
      return new Enumerable(function() {
        return new Enumerator(function() {
          return condition() ? {
            done: false,
            value: source
          } : {
            done: true,
            value: undefined
          };
        });
      });
    }
    observableProto.letBind = observableProto['let'] = function(func) {
      return func(this);
    };
    Observable['if'] = Observable.ifThen = function(condition, thenSource, elseSourceOrScheduler) {
      return observableDefer(function() {
        elseSourceOrScheduler || (elseSourceOrScheduler = observableEmpty());
        isPromise(thenSource) && (thenSource = observableFromPromise(thenSource));
        isPromise(elseSourceOrScheduler) && (elseSourceOrScheduler = observableFromPromise(elseSourceOrScheduler));
        typeof elseSourceOrScheduler.now === 'function' && (elseSourceOrScheduler = observableEmpty(elseSourceOrScheduler));
        return condition() ? thenSource : elseSourceOrScheduler;
      });
    };
    Observable['for'] = Observable.forIn = function(sources, resultSelector, thisArg) {
      return enumerableOf(sources, resultSelector, thisArg).concat();
    };
    var observableWhileDo = Observable['while'] = Observable.whileDo = function(condition, source) {
      isPromise(source) && (source = observableFromPromise(source));
      return enumerableWhile(condition, source).concat();
    };
    observableProto.doWhile = function(condition) {
      return observableConcat([this, observableWhileDo(condition, this)]);
    };
    Observable['case'] = Observable.switchCase = function(selector, sources, defaultSourceOrScheduler) {
      return observableDefer(function() {
        isPromise(defaultSourceOrScheduler) && (defaultSourceOrScheduler = observableFromPromise(defaultSourceOrScheduler));
        defaultSourceOrScheduler || (defaultSourceOrScheduler = observableEmpty());
        typeof defaultSourceOrScheduler.now === 'function' && (defaultSourceOrScheduler = observableEmpty(defaultSourceOrScheduler));
        var result = sources[selector()];
        isPromise(result) && (result = observableFromPromise(result));
        return result || defaultSourceOrScheduler;
      });
    };
    observableProto.expand = function(selector, scheduler) {
      isScheduler(scheduler) || (scheduler = immediateScheduler);
      var source = this;
      return new AnonymousObservable(function(observer) {
        var q = [],
          m = new SerialDisposable(),
          d = new CompositeDisposable(m),
          activeCount = 0,
          isAcquired = false;
        var ensureActive = function() {
          var isOwner = false;
          if (q.length > 0) {
            isOwner = !isAcquired;
            isAcquired = true;
          }
          if (isOwner) {
            m.setDisposable(scheduler.scheduleRecursive(function(self) {
              var work;
              if (q.length > 0) {
                work = q.shift();
              } else {
                isAcquired = false;
                return ;
              }
              var m1 = new SingleAssignmentDisposable();
              d.add(m1);
              m1.setDisposable(work.subscribe(function(x) {
                observer.onNext(x);
                var result = null;
                try {
                  result = selector(x);
                } catch (e) {
                  observer.onError(e);
                }
                q.push(result);
                activeCount++;
                ensureActive();
              }, observer.onError.bind(observer), function() {
                d.remove(m1);
                activeCount--;
                if (activeCount === 0) {
                  observer.onCompleted();
                }
              }));
              self();
            }));
          }
        };
        q.push(source);
        activeCount++;
        ensureActive();
        return d;
      }, this);
    };
    Observable.forkJoin = function() {
      var allSources = [];
      if (Array.isArray(arguments[0])) {
        allSources = arguments[0];
      } else {
        for (var i = 0,
               len = arguments.length; i < len; i++) {
          allSources.push(arguments[i]);
        }
      }
      return new AnonymousObservable(function(subscriber) {
        var count = allSources.length;
        if (count === 0) {
          subscriber.onCompleted();
          return disposableEmpty;
        }
        var group = new CompositeDisposable(),
          finished = false,
          hasResults = new Array(count),
          hasCompleted = new Array(count),
          results = new Array(count);
        for (var idx = 0; idx < count; idx++) {
          (function(i) {
            var source = allSources[i];
            isPromise(source) && (source = observableFromPromise(source));
            group.add(source.subscribe(function(value) {
              if (!finished) {
                hasResults[i] = true;
                results[i] = value;
              }
            }, function(e) {
              finished = true;
              subscriber.onError(e);
              group.dispose();
            }, function() {
              if (!finished) {
                if (!hasResults[i]) {
                  subscriber.onCompleted();
                  return ;
                }
                hasCompleted[i] = true;
                for (var ix = 0; ix < count; ix++) {
                  if (!hasCompleted[ix]) {
                    return ;
                  }
                }
                finished = true;
                subscriber.onNext(results);
                subscriber.onCompleted();
              }
            }));
          })(idx);
        }
        return group;
      });
    };
    observableProto.forkJoin = function(second, resultSelector) {
      var first = this;
      return new AnonymousObservable(function(observer) {
        var leftStopped = false,
          rightStopped = false,
          hasLeft = false,
          hasRight = false,
          lastLeft,
          lastRight,
          leftSubscription = new SingleAssignmentDisposable(),
          rightSubscription = new SingleAssignmentDisposable();
        isPromise(second) && (second = observableFromPromise(second));
        leftSubscription.setDisposable(first.subscribe(function(left) {
          hasLeft = true;
          lastLeft = left;
        }, function(err) {
          rightSubscription.dispose();
          observer.onError(err);
        }, function() {
          leftStopped = true;
          if (rightStopped) {
            if (!hasLeft) {
              observer.onCompleted();
            } else if (!hasRight) {
              observer.onCompleted();
            } else {
              var result;
              try {
                result = resultSelector(lastLeft, lastRight);
              } catch (e) {
                observer.onError(e);
                return ;
              }
              observer.onNext(result);
              observer.onCompleted();
            }
          }
        }));
        rightSubscription.setDisposable(second.subscribe(function(right) {
          hasRight = true;
          lastRight = right;
        }, function(err) {
          leftSubscription.dispose();
          observer.onError(err);
        }, function() {
          rightStopped = true;
          if (leftStopped) {
            if (!hasLeft) {
              observer.onCompleted();
            } else if (!hasRight) {
              observer.onCompleted();
            } else {
              var result;
              try {
                result = resultSelector(lastLeft, lastRight);
              } catch (e) {
                observer.onError(e);
                return ;
              }
              observer.onNext(result);
              observer.onCompleted();
            }
          }
        }));
        return new CompositeDisposable(leftSubscription, rightSubscription);
      }, first);
    };
    observableProto.manySelect = function(selector, scheduler) {
      isScheduler(scheduler) || (scheduler = immediateScheduler);
      var source = this;
      return observableDefer(function() {
        var chain;
        return source.map(function(x) {
          var curr = new ChainObservable(x);
          chain && chain.onNext(x);
          chain = curr;
          return curr;
        }).tap(noop, function(e) {
          chain && chain.onError(e);
        }, function() {
          chain && chain.onCompleted();
        }).observeOn(scheduler).map(selector);
      }, source);
    };
    var ChainObservable = (function(__super__) {
      function subscribe(observer) {
        var self = this,
          g = new CompositeDisposable();
        g.add(currentThreadScheduler.schedule(function() {
          observer.onNext(self.head);
          g.add(self.tail.mergeAll().subscribe(observer));
        }));
        return g;
      }
      inherits(ChainObservable, __super__);
      function ChainObservable(head) {
        __super__.call(this, subscribe);
        this.head = head;
        this.tail = new AsyncSubject();
      }
      addProperties(ChainObservable.prototype, Observer, {
        onCompleted: function() {
          this.onNext(Observable.empty());
        },
        onError: function(e) {
          this.onNext(Observable.throwError(e));
        },
        onNext: function(v) {
          this.tail.onNext(v);
          this.tail.onCompleted();
        }
      });
      return ChainObservable;
    }(Observable));
    var Map = root.Map || (function() {
        function Map() {
          this._keys = [];
          this._values = [];
        }
        Map.prototype.get = function(key) {
          var i = this._keys.indexOf(key);
          return i !== -1 ? this._values[i] : undefined;
        };
        Map.prototype.set = function(key, value) {
          var i = this._keys.indexOf(key);
          i !== -1 && (this._values[i] = value);
          this._values[this._keys.push(key) - 1] = value;
        };
        Map.prototype.forEach = function(callback, thisArg) {
          for (var i = 0,
                 len = this._keys.length; i < len; i++) {
            callback.call(thisArg, this._values[i], this._keys[i]);
          }
        };
        return Map;
      }());
    function Pattern(patterns) {
      this.patterns = patterns;
    }
    Pattern.prototype.and = function(other) {
      return new Pattern(this.patterns.concat(other));
    };
    Pattern.prototype.thenDo = function(selector) {
      return new Plan(this, selector);
    };
    function Plan(expression, selector) {
      this.expression = expression;
      this.selector = selector;
    }
    Plan.prototype.activate = function(externalSubscriptions, observer, deactivate) {
      var self = this;
      var joinObservers = [];
      for (var i = 0,
             len = this.expression.patterns.length; i < len; i++) {
        joinObservers.push(planCreateObserver(externalSubscriptions, this.expression.patterns[i], observer.onError.bind(observer)));
      }
      var activePlan = new ActivePlan(joinObservers, function() {
        var result;
        try {
          result = self.selector.apply(self, arguments);
        } catch (e) {
          observer.onError(e);
          return ;
        }
        observer.onNext(result);
      }, function() {
        for (var j = 0,
               jlen = joinObservers.length; j < jlen; j++) {
          joinObservers[j].removeActivePlan(activePlan);
        }
        deactivate(activePlan);
      });
      for (i = 0, len = joinObservers.length; i < len; i++) {
        joinObservers[i].addActivePlan(activePlan);
      }
      return activePlan;
    };
    function planCreateObserver(externalSubscriptions, observable, onError) {
      var entry = externalSubscriptions.get(observable);
      if (!entry) {
        var observer = new JoinObserver(observable, onError);
        externalSubscriptions.set(observable, observer);
        return observer;
      }
      return entry;
    }
    function ActivePlan(joinObserverArray, onNext, onCompleted) {
      this.joinObserverArray = joinObserverArray;
      this.onNext = onNext;
      this.onCompleted = onCompleted;
      this.joinObservers = new Map();
      for (var i = 0,
             len = this.joinObserverArray.length; i < len; i++) {
        var joinObserver = this.joinObserverArray[i];
        this.joinObservers.set(joinObserver, joinObserver);
      }
    }
    ActivePlan.prototype.dequeue = function() {
      this.joinObservers.forEach(function(v) {
        v.queue.shift();
      });
    };
    ActivePlan.prototype.match = function() {
      var i,
        len,
        hasValues = true;
      for (i = 0, len = this.joinObserverArray.length; i < len; i++) {
        if (this.joinObserverArray[i].queue.length === 0) {
          hasValues = false;
          break;
        }
      }
      if (hasValues) {
        var firstValues = [],
          isCompleted = false;
        for (i = 0, len = this.joinObserverArray.length; i < len; i++) {
          firstValues.push(this.joinObserverArray[i].queue[0]);
          this.joinObserverArray[i].queue[0].kind === 'C' && (isCompleted = true);
        }
        if (isCompleted) {
          this.onCompleted();
        } else {
          this.dequeue();
          var values = [];
          for (i = 0, len = firstValues.length; i < firstValues.length; i++) {
            values.push(firstValues[i].value);
          }
          this.onNext.apply(this, values);
        }
      }
    };
    var JoinObserver = (function(__super__) {
      inherits(JoinObserver, __super__);
      function JoinObserver(source, onError) {
        __super__.call(this);
        this.source = source;
        this.onError = onError;
        this.queue = [];
        this.activePlans = [];
        this.subscription = new SingleAssignmentDisposable();
        this.isDisposed = false;
      }
      var JoinObserverPrototype = JoinObserver.prototype;
      JoinObserverPrototype.next = function(notification) {
        if (!this.isDisposed) {
          if (notification.kind === 'E') {
            return this.onError(notification.exception);
          }
          this.queue.push(notification);
          var activePlans = this.activePlans.slice(0);
          for (var i = 0,
                 len = activePlans.length; i < len; i++) {
            activePlans[i].match();
          }
        }
      };
      JoinObserverPrototype.error = noop;
      JoinObserverPrototype.completed = noop;
      JoinObserverPrototype.addActivePlan = function(activePlan) {
        this.activePlans.push(activePlan);
      };
      JoinObserverPrototype.subscribe = function() {
        this.subscription.setDisposable(this.source.materialize().subscribe(this));
      };
      JoinObserverPrototype.removeActivePlan = function(activePlan) {
        this.activePlans.splice(this.activePlans.indexOf(activePlan), 1);
        this.activePlans.length === 0 && this.dispose();
      };
      JoinObserverPrototype.dispose = function() {
        __super__.prototype.dispose.call(this);
        if (!this.isDisposed) {
          this.isDisposed = true;
          this.subscription.dispose();
        }
      };
      return JoinObserver;
    }(AbstractObserver));
    observableProto.and = function(right) {
      return new Pattern([this, right]);
    };
    observableProto.thenDo = function(selector) {
      return new Pattern([this]).thenDo(selector);
    };
    Observable.when = function() {
      var len = arguments.length,
        plans;
      if (Array.isArray(arguments[0])) {
        plans = arguments[0];
      } else {
        plans = new Array(len);
        for (var i = 0; i < len; i++) {
          plans[i] = arguments[i];
        }
      }
      return new AnonymousObservable(function(o) {
        var activePlans = [],
          externalSubscriptions = new Map();
        var outObserver = observerCreate(function(x) {
          o.onNext(x);
        }, function(err) {
          externalSubscriptions.forEach(function(v) {
            v.onError(err);
          });
          o.onError(err);
        }, function(x) {
          o.onCompleted();
        });
        try {
          for (var i = 0,
                 len = plans.length; i < len; i++) {
            activePlans.push(plans[i].activate(externalSubscriptions, outObserver, function(activePlan) {
              var idx = activePlans.indexOf(activePlan);
              activePlans.splice(idx, 1);
              activePlans.length === 0 && o.onCompleted();
            }));
          }
        } catch (e) {
          observableThrow(e).subscribe(o);
        }
        var group = new CompositeDisposable();
        externalSubscriptions.forEach(function(joinObserver) {
          joinObserver.subscribe();
          group.add(joinObserver);
        });
        return group;
      });
    };
    function observableTimerDate(dueTime, scheduler) {
      return new AnonymousObservable(function(observer) {
        return scheduler.scheduleWithAbsolute(dueTime, function() {
          observer.onNext(0);
          observer.onCompleted();
        });
      });
    }
    function observableTimerDateAndPeriod(dueTime, period, scheduler) {
      return new AnonymousObservable(function(observer) {
        var d = dueTime,
          p = normalizeTime(period);
        return scheduler.scheduleRecursiveWithAbsoluteAndState(0, d, function(count, self) {
          if (p > 0) {
            var now = scheduler.now();
            d = d + p;
            d <= now && (d = now + p);
          }
          observer.onNext(count);
          self(count + 1, d);
        });
      });
    }
    function observableTimerTimeSpan(dueTime, scheduler) {
      return new AnonymousObservable(function(observer) {
        return scheduler.scheduleWithRelative(normalizeTime(dueTime), function() {
          observer.onNext(0);
          observer.onCompleted();
        });
      });
    }
    function observableTimerTimeSpanAndPeriod(dueTime, period, scheduler) {
      return dueTime === period ? new AnonymousObservable(function(observer) {
        return scheduler.schedulePeriodicWithState(0, period, function(count) {
          observer.onNext(count);
          return count + 1;
        });
      }) : observableDefer(function() {
        return observableTimerDateAndPeriod(scheduler.now() + dueTime, period, scheduler);
      });
    }
    var observableinterval = Observable.interval = function(period, scheduler) {
      return observableTimerTimeSpanAndPeriod(period, period, isScheduler(scheduler) ? scheduler : timeoutScheduler);
    };
    var observableTimer = Observable.timer = function(dueTime, periodOrScheduler, scheduler) {
      var period;
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      if (periodOrScheduler !== undefined && typeof periodOrScheduler === 'number') {
        period = periodOrScheduler;
      } else if (isScheduler(periodOrScheduler)) {
        scheduler = periodOrScheduler;
      }
      if (dueTime instanceof Date && period === undefined) {
        return observableTimerDate(dueTime.getTime(), scheduler);
      }
      if (dueTime instanceof Date && period !== undefined) {
        period = periodOrScheduler;
        return observableTimerDateAndPeriod(dueTime.getTime(), period, scheduler);
      }
      return period === undefined ? observableTimerTimeSpan(dueTime, scheduler) : observableTimerTimeSpanAndPeriod(dueTime, period, scheduler);
    };
    function observableDelayTimeSpan(source, dueTime, scheduler) {
      return new AnonymousObservable(function(observer) {
        var active = false,
          cancelable = new SerialDisposable(),
          exception = null,
          q = [],
          running = false,
          subscription;
        subscription = source.materialize().timestamp(scheduler).subscribe(function(notification) {
          var d,
            shouldRun;
          if (notification.value.kind === 'E') {
            q = [];
            q.push(notification);
            exception = notification.value.exception;
            shouldRun = !running;
          } else {
            q.push({
              value: notification.value,
              timestamp: notification.timestamp + dueTime
            });
            shouldRun = !active;
            active = true;
          }
          if (shouldRun) {
            if (exception !== null) {
              observer.onError(exception);
            } else {
              d = new SingleAssignmentDisposable();
              cancelable.setDisposable(d);
              d.setDisposable(scheduler.scheduleRecursiveWithRelative(dueTime, function(self) {
                var e,
                  recurseDueTime,
                  result,
                  shouldRecurse;
                if (exception !== null) {
                  return ;
                }
                running = true;
                do {
                  result = null;
                  if (q.length > 0 && q[0].timestamp - scheduler.now() <= 0) {
                    result = q.shift().value;
                  }
                  if (result !== null) {
                    result.accept(observer);
                  }
                } while (result !== null);
                shouldRecurse = false;
                recurseDueTime = 0;
                if (q.length > 0) {
                  shouldRecurse = true;
                  recurseDueTime = Math.max(0, q[0].timestamp - scheduler.now());
                } else {
                  active = false;
                }
                e = exception;
                running = false;
                if (e !== null) {
                  observer.onError(e);
                } else if (shouldRecurse) {
                  self(recurseDueTime);
                }
              }));
            }
          }
        });
        return new CompositeDisposable(subscription, cancelable);
      }, source);
    }
    function observableDelayDate(source, dueTime, scheduler) {
      return observableDefer(function() {
        return observableDelayTimeSpan(source, dueTime - scheduler.now(), scheduler);
      });
    }
    observableProto.delay = function(dueTime, scheduler) {
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return dueTime instanceof Date ? observableDelayDate(this, dueTime.getTime(), scheduler) : observableDelayTimeSpan(this, dueTime, scheduler);
    };
    observableProto.debounce = observableProto.throttleWithTimeout = function(dueTime, scheduler) {
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      var source = this;
      return new AnonymousObservable(function(observer) {
        var cancelable = new SerialDisposable(),
          hasvalue = false,
          value,
          id = 0;
        var subscription = source.subscribe(function(x) {
          hasvalue = true;
          value = x;
          id++;
          var currentId = id,
            d = new SingleAssignmentDisposable();
          cancelable.setDisposable(d);
          d.setDisposable(scheduler.scheduleWithRelative(dueTime, function() {
            hasvalue && id === currentId && observer.onNext(value);
            hasvalue = false;
          }));
        }, function(e) {
          cancelable.dispose();
          observer.onError(e);
          hasvalue = false;
          id++;
        }, function() {
          cancelable.dispose();
          hasvalue && observer.onNext(value);
          observer.onCompleted();
          hasvalue = false;
          id++;
        });
        return new CompositeDisposable(subscription, cancelable);
      }, this);
    };
    observableProto.throttle = function(dueTime, scheduler) {
      return this.debounce(dueTime, scheduler);
    };
    observableProto.windowWithTime = function(timeSpan, timeShiftOrScheduler, scheduler) {
      var source = this,
        timeShift;
      timeShiftOrScheduler == null && (timeShift = timeSpan);
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      if (typeof timeShiftOrScheduler === 'number') {
        timeShift = timeShiftOrScheduler;
      } else if (isScheduler(timeShiftOrScheduler)) {
        timeShift = timeSpan;
        scheduler = timeShiftOrScheduler;
      }
      return new AnonymousObservable(function(observer) {
        var groupDisposable,
          nextShift = timeShift,
          nextSpan = timeSpan,
          q = [],
          refCountDisposable,
          timerD = new SerialDisposable(),
          totalTime = 0;
        groupDisposable = new CompositeDisposable(timerD), refCountDisposable = new RefCountDisposable(groupDisposable);
        function createTimer() {
          var m = new SingleAssignmentDisposable(),
            isSpan = false,
            isShift = false;
          timerD.setDisposable(m);
          if (nextSpan === nextShift) {
            isSpan = true;
            isShift = true;
          } else if (nextSpan < nextShift) {
            isSpan = true;
          } else {
            isShift = true;
          }
          var newTotalTime = isSpan ? nextSpan : nextShift,
            ts = newTotalTime - totalTime;
          totalTime = newTotalTime;
          if (isSpan) {
            nextSpan += timeShift;
          }
          if (isShift) {
            nextShift += timeShift;
          }
          m.setDisposable(scheduler.scheduleWithRelative(ts, function() {
            if (isShift) {
              var s = new Subject();
              q.push(s);
              observer.onNext(addRef(s, refCountDisposable));
            }
            isSpan && q.shift().onCompleted();
            createTimer();
          }));
        }
        ;
        q.push(new Subject());
        observer.onNext(addRef(q[0], refCountDisposable));
        createTimer();
        groupDisposable.add(source.subscribe(function(x) {
          for (var i = 0,
                 len = q.length; i < len; i++) {
            q[i].onNext(x);
          }
        }, function(e) {
          for (var i = 0,
                 len = q.length; i < len; i++) {
            q[i].onError(e);
          }
          observer.onError(e);
        }, function() {
          for (var i = 0,
                 len = q.length; i < len; i++) {
            q[i].onCompleted();
          }
          observer.onCompleted();
        }));
        return refCountDisposable;
      }, source);
    };
    observableProto.windowWithTimeOrCount = function(timeSpan, count, scheduler) {
      var source = this;
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return new AnonymousObservable(function(observer) {
        var timerD = new SerialDisposable(),
          groupDisposable = new CompositeDisposable(timerD),
          refCountDisposable = new RefCountDisposable(groupDisposable),
          n = 0,
          windowId = 0,
          s = new Subject();
        function createTimer(id) {
          var m = new SingleAssignmentDisposable();
          timerD.setDisposable(m);
          m.setDisposable(scheduler.scheduleWithRelative(timeSpan, function() {
            if (id !== windowId) {
              return ;
            }
            n = 0;
            var newId = ++windowId;
            s.onCompleted();
            s = new Subject();
            observer.onNext(addRef(s, refCountDisposable));
            createTimer(newId);
          }));
        }
        observer.onNext(addRef(s, refCountDisposable));
        createTimer(0);
        groupDisposable.add(source.subscribe(function(x) {
          var newId = 0,
            newWindow = false;
          s.onNext(x);
          if (++n === count) {
            newWindow = true;
            n = 0;
            newId = ++windowId;
            s.onCompleted();
            s = new Subject();
            observer.onNext(addRef(s, refCountDisposable));
          }
          newWindow && createTimer(newId);
        }, function(e) {
          s.onError(e);
          observer.onError(e);
        }, function() {
          s.onCompleted();
          observer.onCompleted();
        }));
        return refCountDisposable;
      }, source);
    };
    observableProto.bufferWithTime = function(timeSpan, timeShiftOrScheduler, scheduler) {
      return this.windowWithTime.apply(this, arguments).selectMany(function(x) {
        return x.toArray();
      });
    };
    observableProto.bufferWithTimeOrCount = function(timeSpan, count, scheduler) {
      return this.windowWithTimeOrCount(timeSpan, count, scheduler).selectMany(function(x) {
        return x.toArray();
      });
    };
    observableProto.timeInterval = function(scheduler) {
      var source = this;
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return observableDefer(function() {
        var last = scheduler.now();
        return source.map(function(x) {
          var now = scheduler.now(),
            span = now - last;
          last = now;
          return {
            value: x,
            interval: span
          };
        });
      });
    };
    observableProto.timestamp = function(scheduler) {
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return this.map(function(x) {
        return {
          value: x,
          timestamp: scheduler.now()
        };
      });
    };
    function sampleObservable(source, sampler) {
      return new AnonymousObservable(function(observer) {
        var atEnd,
          value,
          hasValue;
        function sampleSubscribe() {
          if (hasValue) {
            hasValue = false;
            observer.onNext(value);
          }
          atEnd && observer.onCompleted();
        }
        return new CompositeDisposable(source.subscribe(function(newValue) {
          hasValue = true;
          value = newValue;
        }, observer.onError.bind(observer), function() {
          atEnd = true;
        }), sampler.subscribe(sampleSubscribe, observer.onError.bind(observer), sampleSubscribe));
      }, source);
    }
    observableProto.sample = observableProto.throttleLatest = function(intervalOrSampler, scheduler) {
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return typeof intervalOrSampler === 'number' ? sampleObservable(this, observableinterval(intervalOrSampler, scheduler)) : sampleObservable(this, intervalOrSampler);
    };
    observableProto.timeout = function(dueTime, other, scheduler) {
      (other == null || typeof other === 'string') && (other = observableThrow(new Error(other || 'Timeout')));
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      var source = this,
        schedulerMethod = dueTime instanceof Date ? 'scheduleWithAbsolute' : 'scheduleWithRelative';
      return new AnonymousObservable(function(observer) {
        var id = 0,
          original = new SingleAssignmentDisposable(),
          subscription = new SerialDisposable(),
          switched = false,
          timer = new SerialDisposable();
        subscription.setDisposable(original);
        function createTimer() {
          var myId = id;
          timer.setDisposable(scheduler[schedulerMethod](dueTime, function() {
            if (id === myId) {
              isPromise(other) && (other = observableFromPromise(other));
              subscription.setDisposable(other.subscribe(observer));
            }
          }));
        }
        createTimer();
        original.setDisposable(source.subscribe(function(x) {
          if (!switched) {
            id++;
            observer.onNext(x);
            createTimer();
          }
        }, function(e) {
          if (!switched) {
            id++;
            observer.onError(e);
          }
        }, function() {
          if (!switched) {
            id++;
            observer.onCompleted();
          }
        }));
        return new CompositeDisposable(subscription, timer);
      }, source);
    };
    Observable.generateWithAbsoluteTime = function(initialState, condition, iterate, resultSelector, timeSelector, scheduler) {
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return new AnonymousObservable(function(observer) {
        var first = true,
          hasResult = false,
          result,
          state = initialState,
          time;
        return scheduler.scheduleRecursiveWithAbsolute(scheduler.now(), function(self) {
          hasResult && observer.onNext(result);
          try {
            if (first) {
              first = false;
            } else {
              state = iterate(state);
            }
            hasResult = condition(state);
            if (hasResult) {
              result = resultSelector(state);
              time = timeSelector(state);
            }
          } catch (e) {
            observer.onError(e);
            return ;
          }
          if (hasResult) {
            self(time);
          } else {
            observer.onCompleted();
          }
        });
      });
    };
    Observable.generateWithRelativeTime = function(initialState, condition, iterate, resultSelector, timeSelector, scheduler) {
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return new AnonymousObservable(function(observer) {
        var first = true,
          hasResult = false,
          result,
          state = initialState,
          time;
        return scheduler.scheduleRecursiveWithRelative(0, function(self) {
          hasResult && observer.onNext(result);
          try {
            if (first) {
              first = false;
            } else {
              state = iterate(state);
            }
            hasResult = condition(state);
            if (hasResult) {
              result = resultSelector(state);
              time = timeSelector(state);
            }
          } catch (e) {
            observer.onError(e);
            return ;
          }
          if (hasResult) {
            self(time);
          } else {
            observer.onCompleted();
          }
        });
      });
    };
    observableProto.delaySubscription = function(dueTime, scheduler) {
      return this.delayWithSelector(observableTimer(dueTime, isScheduler(scheduler) ? scheduler : timeoutScheduler), observableEmpty);
    };
    observableProto.delayWithSelector = function(subscriptionDelay, delayDurationSelector) {
      var source = this,
        subDelay,
        selector;
      if (typeof subscriptionDelay === 'function') {
        selector = subscriptionDelay;
      } else {
        subDelay = subscriptionDelay;
        selector = delayDurationSelector;
      }
      return new AnonymousObservable(function(observer) {
        var delays = new CompositeDisposable(),
          atEnd = false,
          done = function() {
            if (atEnd && delays.length === 0) {
              observer.onCompleted();
            }
          },
          subscription = new SerialDisposable(),
          start = function() {
            subscription.setDisposable(source.subscribe(function(x) {
              var delay;
              try {
                delay = selector(x);
              } catch (error) {
                observer.onError(error);
                return ;
              }
              var d = new SingleAssignmentDisposable();
              delays.add(d);
              d.setDisposable(delay.subscribe(function() {
                observer.onNext(x);
                delays.remove(d);
                done();
              }, observer.onError.bind(observer), function() {
                observer.onNext(x);
                delays.remove(d);
                done();
              }));
            }, observer.onError.bind(observer), function() {
              atEnd = true;
              subscription.dispose();
              done();
            }));
          };
        if (!subDelay) {
          start();
        } else {
          subscription.setDisposable(subDelay.subscribe(start, observer.onError.bind(observer), start));
        }
        return new CompositeDisposable(subscription, delays);
      }, this);
    };
    observableProto.timeoutWithSelector = function(firstTimeout, timeoutdurationSelector, other) {
      if (arguments.length === 1) {
        timeoutdurationSelector = firstTimeout;
        firstTimeout = observableNever();
      }
      other || (other = observableThrow(new Error('Timeout')));
      var source = this;
      return new AnonymousObservable(function(observer) {
        var subscription = new SerialDisposable(),
          timer = new SerialDisposable(),
          original = new SingleAssignmentDisposable();
        subscription.setDisposable(original);
        var id = 0,
          switched = false;
        function setTimer(timeout) {
          var myId = id;
          function timerWins() {
            return id === myId;
          }
          var d = new SingleAssignmentDisposable();
          timer.setDisposable(d);
          d.setDisposable(timeout.subscribe(function() {
            timerWins() && subscription.setDisposable(other.subscribe(observer));
            d.dispose();
          }, function(e) {
            timerWins() && observer.onError(e);
          }, function() {
            timerWins() && subscription.setDisposable(other.subscribe(observer));
          }));
        }
        ;
        setTimer(firstTimeout);
        function observerWins() {
          var res = !switched;
          if (res) {
            id++;
          }
          return res;
        }
        original.setDisposable(source.subscribe(function(x) {
          if (observerWins()) {
            observer.onNext(x);
            var timeout;
            try {
              timeout = timeoutdurationSelector(x);
            } catch (e) {
              observer.onError(e);
              return ;
            }
            setTimer(isPromise(timeout) ? observableFromPromise(timeout) : timeout);
          }
        }, function(e) {
          observerWins() && observer.onError(e);
        }, function() {
          observerWins() && observer.onCompleted();
        }));
        return new CompositeDisposable(subscription, timer);
      }, source);
    };
    observableProto.debounceWithSelector = function(durationSelector) {
      var source = this;
      return new AnonymousObservable(function(observer) {
        var value,
          hasValue = false,
          cancelable = new SerialDisposable(),
          id = 0;
        var subscription = source.subscribe(function(x) {
          var throttle;
          try {
            throttle = durationSelector(x);
          } catch (e) {
            observer.onError(e);
            return ;
          }
          isPromise(throttle) && (throttle = observableFromPromise(throttle));
          hasValue = true;
          value = x;
          id++;
          var currentid = id,
            d = new SingleAssignmentDisposable();
          cancelable.setDisposable(d);
          d.setDisposable(throttle.subscribe(function() {
            hasValue && id === currentid && observer.onNext(value);
            hasValue = false;
            d.dispose();
          }, observer.onError.bind(observer), function() {
            hasValue && id === currentid && observer.onNext(value);
            hasValue = false;
            d.dispose();
          }));
        }, function(e) {
          cancelable.dispose();
          observer.onError(e);
          hasValue = false;
          id++;
        }, function() {
          cancelable.dispose();
          hasValue && observer.onNext(value);
          observer.onCompleted();
          hasValue = false;
          id++;
        });
        return new CompositeDisposable(subscription, cancelable);
      }, source);
    };
    observableProto.throttleWithSelector = function(durationSelector) {
      return this.debounceWithSelector(durationSelector);
    };
    observableProto.skipLastWithTime = function(duration, scheduler) {
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      var source = this;
      return new AnonymousObservable(function(o) {
        var q = [];
        return source.subscribe(function(x) {
          var now = scheduler.now();
          q.push({
            interval: now,
            value: x
          });
          while (q.length > 0 && now - q[0].interval >= duration) {
            o.onNext(q.shift().value);
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          var now = scheduler.now();
          while (q.length > 0 && now - q[0].interval >= duration) {
            o.onNext(q.shift().value);
          }
          o.onCompleted();
        });
      }, source);
    };
    observableProto.takeLastWithTime = function(duration, scheduler) {
      var source = this;
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return new AnonymousObservable(function(o) {
        var q = [];
        return source.subscribe(function(x) {
          var now = scheduler.now();
          q.push({
            interval: now,
            value: x
          });
          while (q.length > 0 && now - q[0].interval >= duration) {
            q.shift();
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          var now = scheduler.now();
          while (q.length > 0) {
            var next = q.shift();
            if (now - next.interval <= duration) {
              o.onNext(next.value);
            }
          }
          o.onCompleted();
        });
      }, source);
    };
    observableProto.takeLastBufferWithTime = function(duration, scheduler) {
      var source = this;
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return new AnonymousObservable(function(o) {
        var q = [];
        return source.subscribe(function(x) {
          var now = scheduler.now();
          q.push({
            interval: now,
            value: x
          });
          while (q.length > 0 && now - q[0].interval >= duration) {
            q.shift();
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          var now = scheduler.now(),
            res = [];
          while (q.length > 0) {
            var next = q.shift();
            now - next.interval <= duration && res.push(next.value);
          }
          o.onNext(res);
          o.onCompleted();
        });
      }, source);
    };
    observableProto.takeWithTime = function(duration, scheduler) {
      var source = this;
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return new AnonymousObservable(function(o) {
        return new CompositeDisposable(scheduler.scheduleWithRelative(duration, function() {
          o.onCompleted();
        }), source.subscribe(o));
      }, source);
    };
    observableProto.skipWithTime = function(duration, scheduler) {
      var source = this;
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      return new AnonymousObservable(function(observer) {
        var open = false;
        return new CompositeDisposable(scheduler.scheduleWithRelative(duration, function() {
          open = true;
        }), source.subscribe(function(x) {
          open && observer.onNext(x);
        }, observer.onError.bind(observer), observer.onCompleted.bind(observer)));
      }, source);
    };
    observableProto.skipUntilWithTime = function(startTime, scheduler) {
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      var source = this,
        schedulerMethod = startTime instanceof Date ? 'scheduleWithAbsolute' : 'scheduleWithRelative';
      return new AnonymousObservable(function(o) {
        var open = false;
        return new CompositeDisposable(scheduler[schedulerMethod](startTime, function() {
          open = true;
        }), source.subscribe(function(x) {
          open && o.onNext(x);
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onCompleted();
        }));
      }, source);
    };
    observableProto.takeUntilWithTime = function(endTime, scheduler) {
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      var source = this,
        schedulerMethod = endTime instanceof Date ? 'scheduleWithAbsolute' : 'scheduleWithRelative';
      return new AnonymousObservable(function(o) {
        return new CompositeDisposable(scheduler[schedulerMethod](endTime, function() {
          o.onCompleted();
        }), source.subscribe(o));
      }, source);
    };
    observableProto.throttleFirst = function(windowDuration, scheduler) {
      isScheduler(scheduler) || (scheduler = timeoutScheduler);
      var duration = +windowDuration || 0;
      if (duration <= 0) {
        throw new RangeError('windowDuration cannot be less or equal zero.');
      }
      var source = this;
      return new AnonymousObservable(function(o) {
        var lastOnNext = 0;
        return source.subscribe(function(x) {
          var now = scheduler.now();
          if (lastOnNext === 0 || now - lastOnNext >= duration) {
            lastOnNext = now;
            o.onNext(x);
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          o.onCompleted();
        });
      }, source);
    };
    observableProto.transduce = function(transducer) {
      var source = this;
      function transformForObserver(o) {
        return {
          '@@transducer/init': function() {
            return o;
          },
          '@@transducer/step': function(obs, input) {
            return obs.onNext(input);
          },
          '@@transducer/result': function(obs) {
            return obs.onCompleted();
          }
        };
      }
      return new AnonymousObservable(function(o) {
        var xform = transducer(transformForObserver(o));
        return source.subscribe(function(v) {
          try {
            xform['@@transducer/step'](o, v);
          } catch (e) {
            o.onError(e);
          }
        }, function(e) {
          o.onError(e);
        }, function() {
          xform['@@transducer/result'](o);
        });
      }, source);
    };
    observableProto.exclusive = function() {
      var sources = this;
      return new AnonymousObservable(function(observer) {
        var hasCurrent = false,
          isStopped = false,
          m = new SingleAssignmentDisposable(),
          g = new CompositeDisposable();
        g.add(m);
        m.setDisposable(sources.subscribe(function(innerSource) {
          if (!hasCurrent) {
            hasCurrent = true;
            isPromise(innerSource) && (innerSource = observableFromPromise(innerSource));
            var innerSubscription = new SingleAssignmentDisposable();
            g.add(innerSubscription);
            innerSubscription.setDisposable(innerSource.subscribe(observer.onNext.bind(observer), observer.onError.bind(observer), function() {
              g.remove(innerSubscription);
              hasCurrent = false;
              if (isStopped && g.length === 1) {
                observer.onCompleted();
              }
            }));
          }
        }, observer.onError.bind(observer), function() {
          isStopped = true;
          if (!hasCurrent && g.length === 1) {
            observer.onCompleted();
          }
        }));
        return g;
      }, this);
    };
    observableProto.exclusiveMap = function(selector, thisArg) {
      var sources = this,
        selectorFunc = bindCallback(selector, thisArg, 3);
      return new AnonymousObservable(function(observer) {
        var index = 0,
          hasCurrent = false,
          isStopped = true,
          m = new SingleAssignmentDisposable(),
          g = new CompositeDisposable();
        g.add(m);
        m.setDisposable(sources.subscribe(function(innerSource) {
          if (!hasCurrent) {
            hasCurrent = true;
            innerSubscription = new SingleAssignmentDisposable();
            g.add(innerSubscription);
            isPromise(innerSource) && (innerSource = observableFromPromise(innerSource));
            innerSubscription.setDisposable(innerSource.subscribe(function(x) {
              var result;
              try {
                result = selectorFunc(x, index++, innerSource);
              } catch (e) {
                observer.onError(e);
                return ;
              }
              observer.onNext(result);
            }, function(e) {
              observer.onError(e);
            }, function() {
              g.remove(innerSubscription);
              hasCurrent = false;
              if (isStopped && g.length === 1) {
                observer.onCompleted();
              }
            }));
          }
        }, function(e) {
          observer.onError(e);
        }, function() {
          isStopped = true;
          if (g.length === 1 && !hasCurrent) {
            observer.onCompleted();
          }
        }));
        return g;
      }, this);
    };
    Rx.VirtualTimeScheduler = (function(__super__) {
      function localNow() {
        return this.toDateTimeOffset(this.clock);
      }
      function scheduleNow(state, action) {
        return this.scheduleAbsoluteWithState(state, this.clock, action);
      }
      function scheduleRelative(state, dueTime, action) {
        return this.scheduleRelativeWithState(state, this.toRelative(dueTime), action);
      }
      function scheduleAbsolute(state, dueTime, action) {
        return this.scheduleRelativeWithState(state, this.toRelative(dueTime - this.now()), action);
      }
      function invokeAction(scheduler, action) {
        action();
        return disposableEmpty;
      }
      inherits(VirtualTimeScheduler, __super__);
      function VirtualTimeScheduler(initialClock, comparer) {
        this.clock = initialClock;
        this.comparer = comparer;
        this.isEnabled = false;
        this.queue = new PriorityQueue(1024);
        __super__.call(this, localNow, scheduleNow, scheduleRelative, scheduleAbsolute);
      }
      var VirtualTimeSchedulerPrototype = VirtualTimeScheduler.prototype;
      VirtualTimeSchedulerPrototype.add = notImplemented;
      VirtualTimeSchedulerPrototype.toDateTimeOffset = notImplemented;
      VirtualTimeSchedulerPrototype.toRelative = notImplemented;
      VirtualTimeSchedulerPrototype.schedulePeriodicWithState = function(state, period, action) {
        var s = new SchedulePeriodicRecursive(this, state, period, action);
        return s.start();
      };
      VirtualTimeSchedulerPrototype.scheduleRelativeWithState = function(state, dueTime, action) {
        var runAt = this.add(this.clock, dueTime);
        return this.scheduleAbsoluteWithState(state, runAt, action);
      };
      VirtualTimeSchedulerPrototype.scheduleRelative = function(dueTime, action) {
        return this.scheduleRelativeWithState(action, dueTime, invokeAction);
      };
      VirtualTimeSchedulerPrototype.start = function() {
        if (!this.isEnabled) {
          this.isEnabled = true;
          do {
            var next = this.getNext();
            if (next !== null) {
              this.comparer(next.dueTime, this.clock) > 0 && (this.clock = next.dueTime);
              next.invoke();
            } else {
              this.isEnabled = false;
            }
          } while (this.isEnabled);
        }
      };
      VirtualTimeSchedulerPrototype.stop = function() {
        this.isEnabled = false;
      };
      VirtualTimeSchedulerPrototype.advanceTo = function(time) {
        var dueToClock = this.comparer(this.clock, time);
        if (this.comparer(this.clock, time) > 0) {
          throw new ArgumentOutOfRangeError();
        }
        if (dueToClock === 0) {
          return ;
        }
        if (!this.isEnabled) {
          this.isEnabled = true;
          do {
            var next = this.getNext();
            if (next !== null && this.comparer(next.dueTime, time) <= 0) {
              this.comparer(next.dueTime, this.clock) > 0 && (this.clock = next.dueTime);
              next.invoke();
            } else {
              this.isEnabled = false;
            }
          } while (this.isEnabled);
          this.clock = time;
        }
      };
      VirtualTimeSchedulerPrototype.advanceBy = function(time) {
        var dt = this.add(this.clock, time),
          dueToClock = this.comparer(this.clock, dt);
        if (dueToClock > 0) {
          throw new ArgumentOutOfRangeError();
        }
        if (dueToClock === 0) {
          return ;
        }
        this.advanceTo(dt);
      };
      VirtualTimeSchedulerPrototype.sleep = function(time) {
        var dt = this.add(this.clock, time);
        if (this.comparer(this.clock, dt) >= 0) {
          throw new ArgumentOutOfRangeError();
        }
        this.clock = dt;
      };
      VirtualTimeSchedulerPrototype.getNext = function() {
        while (this.queue.length > 0) {
          var next = this.queue.peek();
          if (next.isCancelled()) {
            this.queue.dequeue();
          } else {
            return next;
          }
        }
        return null;
      };
      VirtualTimeSchedulerPrototype.scheduleAbsolute = function(dueTime, action) {
        return this.scheduleAbsoluteWithState(action, dueTime, invokeAction);
      };
      VirtualTimeSchedulerPrototype.scheduleAbsoluteWithState = function(state, dueTime, action) {
        var self = this;
        function run(scheduler, state1) {
          self.queue.remove(si);
          return action(scheduler, state1);
        }
        var si = new ScheduledItem(this, state, run, dueTime, this.comparer);
        this.queue.enqueue(si);
        return si.disposable;
      };
      return VirtualTimeScheduler;
    }(Scheduler));
    Rx.HistoricalScheduler = (function(__super__) {
      inherits(HistoricalScheduler, __super__);
      function HistoricalScheduler(initialClock, comparer) {
        var clock = initialClock == null ? 0 : initialClock;
        var cmp = comparer || defaultSubComparer;
        __super__.call(this, clock, cmp);
      }
      var HistoricalSchedulerProto = HistoricalScheduler.prototype;
      HistoricalSchedulerProto.add = function(absolute, relative) {
        return absolute + relative;
      };
      HistoricalSchedulerProto.toDateTimeOffset = function(absolute) {
        return new Date(absolute).getTime();
      };
      HistoricalSchedulerProto.toRelative = function(timeSpan) {
        return timeSpan;
      };
      return HistoricalScheduler;
    }(Rx.VirtualTimeScheduler));
    var AnonymousObservable = Rx.AnonymousObservable = (function(__super__) {
      inherits(AnonymousObservable, __super__);
      function fixSubscriber(subscriber) {
        return subscriber && isFunction(subscriber.dispose) ? subscriber : isFunction(subscriber) ? disposableCreate(subscriber) : disposableEmpty;
      }
      function setDisposable(s, state) {
        var ado = state[0],
          subscribe = state[1];
        var sub = tryCatch(subscribe)(ado);
        if (sub === errorObj) {
          if (!ado.fail(errorObj.e)) {
            return thrower(errorObj.e);
          }
        }
        ado.setDisposable(fixSubscriber(sub));
      }
      function AnonymousObservable(subscribe, parent) {
        this.source = parent;
        function s(observer) {
          var ado = new AutoDetachObserver(observer),
            state = [ado, subscribe];
          if (currentThreadScheduler.scheduleRequired()) {
            currentThreadScheduler.scheduleWithState(state, setDisposable);
          } else {
            setDisposable(null, state);
          }
          return ado;
        }
        __super__.call(this, s);
      }
      return AnonymousObservable;
    }(Observable));
    var AutoDetachObserver = (function(__super__) {
      inherits(AutoDetachObserver, __super__);
      function AutoDetachObserver(observer) {
        __super__.call(this);
        this.observer = observer;
        this.m = new SingleAssignmentDisposable();
      }
      var AutoDetachObserverPrototype = AutoDetachObserver.prototype;
      AutoDetachObserverPrototype.next = function(value) {
        var result = tryCatch(this.observer.onNext).call(this.observer, value);
        if (result === errorObj) {
          this.dispose();
          thrower(result.e);
        }
      };
      AutoDetachObserverPrototype.error = function(err) {
        var result = tryCatch(this.observer.onError).call(this.observer, err);
        this.dispose();
        result === errorObj && thrower(result.e);
      };
      AutoDetachObserverPrototype.completed = function() {
        var result = tryCatch(this.observer.onCompleted).call(this.observer);
        this.dispose();
        result === errorObj && thrower(result.e);
      };
      AutoDetachObserverPrototype.setDisposable = function(value) {
        this.m.setDisposable(value);
      };
      AutoDetachObserverPrototype.getDisposable = function() {
        return this.m.getDisposable();
      };
      AutoDetachObserverPrototype.dispose = function() {
        __super__.prototype.dispose.call(this);
        this.m.dispose();
      };
      return AutoDetachObserver;
    }(AbstractObserver));
    var GroupedObservable = (function(__super__) {
      inherits(GroupedObservable, __super__);
      function subscribe(observer) {
        return this.underlyingObservable.subscribe(observer);
      }
      function GroupedObservable(key, underlyingObservable, mergedDisposable) {
        __super__.call(this, subscribe);
        this.key = key;
        this.underlyingObservable = !mergedDisposable ? underlyingObservable : new AnonymousObservable(function(observer) {
          return new CompositeDisposable(mergedDisposable.getDisposable(), underlyingObservable.subscribe(observer));
        });
      }
      return GroupedObservable;
    }(Observable));
    var Subject = Rx.Subject = (function(__super__) {
      function subscribe(observer) {
        checkDisposed(this);
        if (!this.isStopped) {
          this.observers.push(observer);
          return new InnerSubscription(this, observer);
        }
        if (this.hasError) {
          observer.onError(this.error);
          return disposableEmpty;
        }
        observer.onCompleted();
        return disposableEmpty;
      }
      inherits(Subject, __super__);
      function Subject() {
        __super__.call(this, subscribe);
        this.isDisposed = false, this.isStopped = false, this.observers = [];
        this.hasError = false;
      }
      addProperties(Subject.prototype, Observer.prototype, {
        hasObservers: function() {
          return this.observers.length > 0;
        },
        onCompleted: function() {
          checkDisposed(this);
          if (!this.isStopped) {
            this.isStopped = true;
            for (var i = 0,
                   os = cloneArray(this.observers),
                   len = os.length; i < len; i++) {
              os[i].onCompleted();
            }
            this.observers.length = 0;
          }
        },
        onError: function(error) {
          checkDisposed(this);
          if (!this.isStopped) {
            this.isStopped = true;
            this.error = error;
            this.hasError = true;
            for (var i = 0,
                   os = cloneArray(this.observers),
                   len = os.length; i < len; i++) {
              os[i].onError(error);
            }
            this.observers.length = 0;
          }
        },
        onNext: function(value) {
          checkDisposed(this);
          if (!this.isStopped) {
            for (var i = 0,
                   os = cloneArray(this.observers),
                   len = os.length; i < len; i++) {
              os[i].onNext(value);
            }
          }
        },
        dispose: function() {
          this.isDisposed = true;
          this.observers = null;
        }
      });
      Subject.create = function(observer, observable) {
        return new AnonymousSubject(observer, observable);
      };
      return Subject;
    }(Observable));
    var AsyncSubject = Rx.AsyncSubject = (function(__super__) {
      function subscribe(observer) {
        checkDisposed(this);
        if (!this.isStopped) {
          this.observers.push(observer);
          return new InnerSubscription(this, observer);
        }
        if (this.hasError) {
          observer.onError(this.error);
        } else if (this.hasValue) {
          observer.onNext(this.value);
          observer.onCompleted();
        } else {
          observer.onCompleted();
        }
        return disposableEmpty;
      }
      inherits(AsyncSubject, __super__);
      function AsyncSubject() {
        __super__.call(this, subscribe);
        this.isDisposed = false;
        this.isStopped = false;
        this.hasValue = false;
        this.observers = [];
        this.hasError = false;
      }
      addProperties(AsyncSubject.prototype, Observer, {
        hasObservers: function() {
          checkDisposed(this);
          return this.observers.length > 0;
        },
        onCompleted: function() {
          var i,
            len;
          checkDisposed(this);
          if (!this.isStopped) {
            this.isStopped = true;
            var os = cloneArray(this.observers),
              len = os.length;
            if (this.hasValue) {
              for (i = 0; i < len; i++) {
                var o = os[i];
                o.onNext(this.value);
                o.onCompleted();
              }
            } else {
              for (i = 0; i < len; i++) {
                os[i].onCompleted();
              }
            }
            this.observers.length = 0;
          }
        },
        onError: function(error) {
          checkDisposed(this);
          if (!this.isStopped) {
            this.isStopped = true;
            this.hasError = true;
            this.error = error;
            for (var i = 0,
                   os = cloneArray(this.observers),
                   len = os.length; i < len; i++) {
              os[i].onError(error);
            }
            this.observers.length = 0;
          }
        },
        onNext: function(value) {
          checkDisposed(this);
          if (this.isStopped) {
            return ;
          }
          this.value = value;
          this.hasValue = true;
        },
        dispose: function() {
          this.isDisposed = true;
          this.observers = null;
          this.exception = null;
          this.value = null;
        }
      });
      return AsyncSubject;
    }(Observable));
    var AnonymousSubject = Rx.AnonymousSubject = (function(__super__) {
      inherits(AnonymousSubject, __super__);
      function subscribe(observer) {
        return this.observable.subscribe(observer);
      }
      function AnonymousSubject(observer, observable) {
        this.observer = observer;
        this.observable = observable;
        __super__.call(this, subscribe);
      }
      addProperties(AnonymousSubject.prototype, Observer.prototype, {
        onCompleted: function() {
          this.observer.onCompleted();
        },
        onError: function(error) {
          this.observer.onError(error);
        },
        onNext: function(value) {
          this.observer.onNext(value);
        }
      });
      return AnonymousSubject;
    }(Observable));
    Rx.Pauser = (function(__super__) {
      inherits(Pauser, __super__);
      function Pauser() {
        __super__.call(this);
      }
      Pauser.prototype.pause = function() {
        this.onNext(false);
      };
      Pauser.prototype.resume = function() {
        this.onNext(true);
      };
      return Pauser;
    }(Subject));
    if (typeof define == 'function' && typeof define.amd == 'object' && define.amd) {
      root.Rx = Rx;
      define(function() {
        return Rx;
      });
    } else if (freeExports && freeModule) {
      if (moduleExports) {
        (freeModule.exports = Rx).Rx = Rx;
      } else {
        freeExports.Rx = Rx;
      }
    } else {
      root.Rx = Rx;
    }
    var rEndingLine = captureLine();
  }.call(this));
  global.define = __define;
  return module.exports;
});

System.register("rtts_assert/src/rtts_assert", [], function($__export) {
  "use strict";
  var __moduleName = "rtts_assert/src/rtts_assert";
  var _global,
    POSITION_NAME,
    primitives,
    genericType,
    string,
    boolean,
    number,
    currentStack,
    prop;
  function argPositionName(i) {
    var position = (i / 2) + 1;
    return POSITION_NAME[position] || (position + 'th');
  }
  function proxy() {}
  function assertArgumentTypes() {
    for (var params = [],
           $__0 = 0; $__0 < arguments.length; $__0++)
      params[$__0] = arguments[$__0];
    var actual,
      type;
    var currentArgErrors;
    var errors = [];
    var msg;
    for (var i = 0,
           l = params.length; i < l; i = i + 2) {
      actual = params[i];
      type = params[i + 1];
      currentArgErrors = [];
      if (!isType(actual, type, currentArgErrors)) {
        errors.push(argPositionName(i) + ' argument has to be an instance of ' + prettyPrint(type) + ', got ' + prettyPrint(actual));
        if (currentArgErrors.length) {
          errors.push(currentArgErrors);
        }
      }
    }
    if (errors.length) {
      throw new Error('Invalid arguments given!\n' + formatErrors(errors));
    }
  }
  function prettyPrint(value, depth) {
    if (typeof(depth) === 'undefined') {
      depth = 0;
    }
    if (depth++ > 3) {
      return '[...]';
    }
    if (typeof value === 'undefined') {
      return 'undefined';
    }
    if (typeof value === 'string') {
      return '"' + value + '"';
    }
    if (typeof value === 'boolean') {
      return value.toString();
    }
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'object') {
      if (value.__assertName) {
        return value.__assertName;
      }
      if (value.map && typeof value.map === 'function') {
        return '[' + value.map((function(v) {
            return prettyPrint(v, depth);
          })).join(', ') + ']';
      }
      var properties = Object.keys(value);
      var suffix = '}';
      if (properties.length > 20) {
        properties.length = 20;
        suffix = ', ... }';
      }
      return '{' + properties.map((function(p) {
          return p + ': ' + prettyPrint(value[p], depth);
        })).join(', ') + suffix;
    }
    return value.__assertName || value.name || value.toString();
  }
  function isType(value, T, errors) {
    if (T && T.type) {
      T = T.type;
    }
    if (T === primitives.void) {
      return typeof value === 'undefined';
    }
    if (_isProxy(value)) {
      return true;
    }
    if (T === primitives.any || value === null) {
      return true;
    }
    if (T === primitives.string) {
      return typeof value === 'string';
    }
    if (T === primitives.number) {
      return typeof value === 'number';
    }
    if (T === primitives.boolean) {
      return typeof value === 'boolean';
    }
    if (typeof T.assert === 'function') {
      var parentStack = currentStack;
      var isValid;
      currentStack = errors;
      try {
        isValid = T.assert(value);
      } catch (e) {
        fail(e.message);
        isValid = false;
      }
      currentStack = parentStack;
      if (typeof isValid === 'undefined') {
        isValid = errors.length === 0;
      }
      return isValid;
    }
    return value instanceof T;
  }
  function _isProxy(obj) {
    if (!obj || !obj.constructor || !obj.constructor.annotations)
      return false;
    return obj.constructor.annotations.filter((function(a) {
        return a instanceof proxy;
      })).length > 0;
  }
  function formatErrors(errors) {
    var indent = arguments[1] !== (void 0) ? arguments[1] : '  ';
    return errors.map((function(e) {
      if (typeof e === 'string')
        return indent + '- ' + e;
      return formatErrors(e, indent + '  ');
    })).join('\n');
  }
  function type(actual, T) {
    var errors = [];
    if (!isType(actual, T, errors)) {
      var msg = 'Expected an instance of ' + prettyPrint(T) + ', got ' + prettyPrint(actual) + '!';
      if (errors.length) {
        msg += '\n' + formatErrors(errors);
      }
      throw new Error(msg);
    }
    return actual;
  }
  function returnType(actual, T) {
    var errors = [];
    if (!isType(actual, T, errors)) {
      var msg = 'Expected to return an instance of ' + prettyPrint(T) + ', got ' + prettyPrint(actual) + '!';
      if (errors.length) {
        msg += '\n' + formatErrors(errors);
      }
      throw new Error(msg);
    }
    return actual;
  }
  function arrayOf() {
    for (var types = [],
           $__1 = 0; $__1 < arguments.length; $__1++)
      types[$__1] = arguments[$__1];
    return assert.define('array of ' + types.map(prettyPrint).join('/'), function(value) {
      var $__3;
      if (assert(value).is(Array)) {
        for (var i = 0; i < value.length; i++) {
          ($__3 = assert(value[i])).is.apply($__3, $traceurRuntime.spread(types));
        }
      }
    });
  }
  function structure(definition) {
    var properties = Object.keys(definition);
    return assert.define('object with properties ' + properties.join(', '), function(value) {
      if (assert(value).is(Object)) {
        for (var i = 0; i < properties.length; i++) {
          var property = properties[i];
          assert(value[property]).is(definition[property]);
        }
      }
    });
  }
  function fail(message) {
    currentStack.push(message);
  }
  function define(classOrName, check) {
    var cls = classOrName;
    if (typeof classOrName === 'string') {
      cls = function() {};
      cls.__assertName = classOrName;
    }
    cls.assert = function(value) {
      return check(value);
    };
    return cls;
  }
  function assert(value) {
    return {is: function is() {
      var $__3;
      for (var types = [],
             $__2 = 0; $__2 < arguments.length; $__2++)
        types[$__2] = arguments[$__2];
      var allErrors = [];
      var errors;
      for (var i = 0; i < types.length; i++) {
        var type = types[i];
        errors = [];
        if (isType(value, type, errors)) {
          return true;
        }
        allErrors.push(prettyPrint(value) + ' is not instance of ' + prettyPrint(type));
        if (errors.length) {
          allErrors.push(errors);
        }
      }
      ($__3 = currentStack).push.apply($__3, $traceurRuntime.spread(allErrors));
      return false;
    }};
  }
  $__export("proxy", proxy);
  return {
    setters: [],
    execute: function() {
      _global = typeof window === 'object' ? window : global;
      POSITION_NAME = ['', '1st', '2nd', '3rd'];
      if (typeof $traceurRuntime === 'object') {
        primitives = $traceurRuntime.type;
        genericType = $traceurRuntime.genericType;
      } else {
        primitives = {
          any: {name: 'any'},
          boolean: {name: 'boolean'},
          number: {name: 'number'},
          string: {name: 'string'},
          symbol: {name: 'symbol'},
          void: {name: 'void'}
        };
        genericType = function(type, args) {
          return {
            type: type,
            args: args
          };
        };
      }
      Object.keys(primitives).forEach(function(name) {
        primitives[name].__assertName = name;
      });
      string = type.string = define('string', function(value) {
        return typeof value === 'string';
      });
      boolean = type.boolean = define('boolean', function(value) {
        return typeof value === 'boolean';
      });
      number = type.number = define('number', function(value) {
        return typeof value === 'number';
      });
      currentStack = [];
      assert.type = type;
      for (prop in primitives) {
        assert.type[prop] = primitives[prop];
      }
      assert.genericType = genericType;
      assert.argumentTypes = assertArgumentTypes;
      assert.returnType = returnType;
      assert.define = define;
      assert.fail = fail;
      assert.string = string;
      assert.number = number;
      assert.boolean = boolean;
      assert.arrayOf = arrayOf;
      assert.structure = structure;
      $__export("assert", assert);
    }
  };
});

System.register("angular2/src/facade/lang", ["rtts_assert/rtts_assert"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/facade/lang";
  var assert,
    _global,
    Type,
    Math,
    Date,
    assertionsEnabled_,
    int,
    CONST,
    ABSTRACT,
    IMPLEMENTS,
    StringWrapper,
    StringJoiner,
    NumberParseError,
    NumberWrapper,
    RegExp,
    RegExpWrapper,
    RegExpMatcherWrapper,
    FunctionWrapper,
    BaseException,
    Json,
    DateWrapper;
  function isPresent(obj) {
    return assert.returnType((obj !== undefined && obj !== null), assert.type.boolean);
  }
  function isBlank(obj) {
    return assert.returnType((obj === undefined || obj === null), assert.type.boolean);
  }
  function isString(obj) {
    return assert.returnType((typeof obj === "string"), assert.type.boolean);
  }
  function isFunction(obj) {
    return assert.returnType((typeof obj === "function"), assert.type.boolean);
  }
  function stringify(token) {
    if (typeof token === 'string') {
      return assert.returnType((token), assert.type.string);
    }
    if (token === undefined || token === null) {
      return assert.returnType(('' + token), assert.type.string);
    }
    if (token.name) {
      return assert.returnType((token.name), assert.type.string);
    }
    return assert.returnType((token.toString()), assert.type.string);
  }
  function looseIdentical(a, b) {
    return assert.returnType((a === b || typeof a === "number" && typeof b === "number" && isNaN(a) && isNaN(b)), assert.type.boolean);
  }
  function getMapKey(value) {
    return value;
  }
  function normalizeBlank(obj) {
    return isBlank(obj) ? null : obj;
  }
  function isJsObject(o) {
    return assert.returnType((o !== null && (typeof o === "function" || typeof o === "object")), assert.type.boolean);
  }
  function assertionsEnabled() {
    return assert.returnType((assertionsEnabled_), assert.type.boolean);
  }
  function print(obj) {
    if (obj instanceof Error) {
      console.log(obj.stack);
    } else {
      console.log(obj);
    }
  }
  $__export("isPresent", isPresent);
  $__export("isBlank", isBlank);
  $__export("isString", isString);
  $__export("isFunction", isFunction);
  $__export("stringify", stringify);
  $__export("looseIdentical", looseIdentical);
  $__export("getMapKey", getMapKey);
  $__export("normalizeBlank", normalizeBlank);
  $__export("isJsObject", isJsObject);
  $__export("assertionsEnabled", assertionsEnabled);
  $__export("print", print);
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }],
    execute: function() {
      _global = typeof window === 'undefined' ? global : window;
      $__export("global", _global);
      Type = $__export("Type", Function);
      Math = $__export("Math", _global.Math);
      Date = $__export("Date", _global.Date);
      assertionsEnabled_ = typeof assert !== 'undefined';
      if (assertionsEnabled_) {
        _global.assert = assert;
        $__export("int", int = assert.define('int', function(value) {
          return typeof value === 'number' && value % 1 === 0;
        }));
      } else {
        $__export("int", int = {});
        _global.assert = function() {};
      }
      $__export("int", int);
      CONST = $__export("CONST", (function() {
        var CONST = function CONST() {
          ;
        };
        return ($traceurRuntime.createClass)(CONST, {}, {});
      }()));
      ABSTRACT = $__export("ABSTRACT", (function() {
        var ABSTRACT = function ABSTRACT() {
          ;
        };
        return ($traceurRuntime.createClass)(ABSTRACT, {}, {});
      }()));
      IMPLEMENTS = $__export("IMPLEMENTS", (function() {
        var IMPLEMENTS = function IMPLEMENTS() {
          ;
        };
        return ($traceurRuntime.createClass)(IMPLEMENTS, {}, {});
      }()));
      StringWrapper = $__export("StringWrapper", (function() {
        var StringWrapper = function StringWrapper() {
          ;
        };
        return ($traceurRuntime.createClass)(StringWrapper, {}, {
          fromCharCode: function(code) {
            assert.argumentTypes(code, int);
            return assert.returnType((String.fromCharCode(code)), assert.type.string);
          },
          charCodeAt: function(s, index) {
            assert.argumentTypes(s, assert.type.string, index, int);
            return s.charCodeAt(index);
          },
          split: function(s, regExp) {
            assert.argumentTypes(s, assert.type.string, regExp, assert.type.any);
            return s.split(regExp);
          },
          equals: function(s, s2) {
            assert.argumentTypes(s, assert.type.string, s2, assert.type.string);
            return assert.returnType((s === s2), assert.type.boolean);
          },
          replace: function(s, from, replace) {
            assert.argumentTypes(s, assert.type.string, from, assert.type.string, replace, assert.type.string);
            return assert.returnType((s.replace(from, replace)), assert.type.string);
          },
          replaceAll: function(s, from, replace) {
            assert.argumentTypes(s, assert.type.string, from, RegExp, replace, assert.type.string);
            return assert.returnType((s.replace(from, replace)), assert.type.string);
          },
          startsWith: function(s, start) {
            assert.argumentTypes(s, assert.type.string, start, assert.type.string);
            return s.startsWith(start);
          },
          substring: function(s, start) {
            var end = arguments[2] !== (void 0) ? arguments[2] : null;
            assert.argumentTypes(s, assert.type.string, start, int, end, int);
            return s.substring(start, end === null ? undefined : end);
          },
          replaceAllMapped: function(s, from, cb) {
            assert.argumentTypes(s, assert.type.string, from, RegExp, cb, Function);
            return assert.returnType((s.replace(from, function() {
              for (var matches = [],
                     $__1 = 0; $__1 < arguments.length; $__1++)
                matches[$__1] = arguments[$__1];
              matches.splice(-2, 2);
              return cb(matches);
            })), assert.type.string);
          },
          contains: function(s, substr) {
            assert.argumentTypes(s, assert.type.string, substr, assert.type.string);
            return assert.returnType((s.indexOf(substr) != -1), assert.type.boolean);
          }
        });
      }()));
      Object.defineProperty(StringWrapper.fromCharCode, "parameters", {get: function() {
        return [[int]];
      }});
      Object.defineProperty(StringWrapper.charCodeAt, "parameters", {get: function() {
        return [[assert.type.string], [int]];
      }});
      Object.defineProperty(StringWrapper.split, "parameters", {get: function() {
        return [[assert.type.string], []];
      }});
      Object.defineProperty(StringWrapper.equals, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(StringWrapper.replace, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(StringWrapper.replaceAll, "parameters", {get: function() {
        return [[assert.type.string], [RegExp], [assert.type.string]];
      }});
      Object.defineProperty(StringWrapper.startsWith, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(StringWrapper.substring, "parameters", {get: function() {
        return [[assert.type.string], [int], [int]];
      }});
      Object.defineProperty(StringWrapper.replaceAllMapped, "parameters", {get: function() {
        return [[assert.type.string], [RegExp], [Function]];
      }});
      Object.defineProperty(StringWrapper.contains, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      StringJoiner = $__export("StringJoiner", (function() {
        var StringJoiner = function StringJoiner() {
          this.parts = [];
        };
        return ($traceurRuntime.createClass)(StringJoiner, {
          add: function(part) {
            assert.argumentTypes(part, assert.type.string);
            this.parts.push(part);
          },
          toString: function() {
            return assert.returnType((this.parts.join("")), assert.type.string);
          }
        }, {});
      }()));
      Object.defineProperty(StringJoiner.prototype.add, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      NumberParseError = $__export("NumberParseError", (function($__super) {
        var NumberParseError = function NumberParseError(message) {
          $traceurRuntime.superConstructor(NumberParseError).call(this);
          this.message = message;
        };
        return ($traceurRuntime.createClass)(NumberParseError, {toString: function() {
          return this.message;
        }}, {}, $__super);
      }(Error)));
      NumberWrapper = $__export("NumberWrapper", (function() {
        var NumberWrapper = function NumberWrapper() {
          ;
        };
        return ($traceurRuntime.createClass)(NumberWrapper, {}, {
          toFixed: function(n, fractionDigits) {
            assert.argumentTypes(n, assert.type.number, fractionDigits, int);
            return assert.returnType((n.toFixed(fractionDigits)), assert.type.string);
          },
          equal: function(a, b) {
            return assert.returnType((a === b), assert.type.boolean);
          },
          parseIntAutoRadix: function(text) {
            assert.argumentTypes(text, assert.type.string);
            var result = assert.type(parseInt(text), int);
            if (isNaN(result)) {
              throw new NumberParseError("Invalid integer literal when parsing " + text);
            }
            return assert.returnType((result), int);
          },
          parseInt: function(text, radix) {
            assert.argumentTypes(text, assert.type.string, radix, int);
            if (radix == 10) {
              if (/^(\-|\+)?[0-9]+$/.test(text)) {
                return assert.returnType((parseInt(text, radix)), int);
              }
            } else if (radix == 16) {
              if (/^(\-|\+)?[0-9ABCDEFabcdef]+$/.test(text)) {
                return assert.returnType((parseInt(text, radix)), int);
              }
            } else {
              var result = assert.type(parseInt(text, radix), int);
              if (!isNaN(result)) {
                return assert.returnType((result), int);
              }
            }
            throw new NumberParseError("Invalid integer literal when parsing " + text + " in base " + radix);
          },
          parseFloat: function(text) {
            assert.argumentTypes(text, assert.type.string);
            return assert.returnType((parseFloat(text)), assert.type.number);
          },
          get NaN() {
            return assert.returnType((NaN), assert.type.number);
          },
          isNaN: function(value) {
            return assert.returnType((isNaN(value)), assert.type.boolean);
          },
          isInteger: function(value) {
            return assert.returnType((Number.isInteger(value)), assert.type.boolean);
          }
        });
      }()));
      Object.defineProperty(NumberWrapper.toFixed, "parameters", {get: function() {
        return [[assert.type.number], [int]];
      }});
      Object.defineProperty(NumberWrapper.parseIntAutoRadix, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(NumberWrapper.parseInt, "parameters", {get: function() {
        return [[assert.type.string], [int]];
      }});
      Object.defineProperty(NumberWrapper.parseFloat, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      RegExp = $__export("RegExp", _global.RegExp);
      RegExpWrapper = $__export("RegExpWrapper", (function() {
        var RegExpWrapper = function RegExpWrapper() {
          ;
        };
        return ($traceurRuntime.createClass)(RegExpWrapper, {}, {
          create: function(regExpStr) {
            var flags = arguments[1] !== (void 0) ? arguments[1] : '';
            assert.argumentTypes(regExpStr, assert.type.any, flags, assert.type.string);
            flags = flags.replace(/g/g, '');
            return assert.returnType((new _global.RegExp(regExpStr, flags + 'g')), RegExp);
          },
          firstMatch: function(regExp, input) {
            regExp.lastIndex = 0;
            return regExp.exec(input);
          },
          matcher: function(regExp, input) {
            regExp.lastIndex = 0;
            return {
              re: regExp,
              input: input
            };
          }
        });
      }()));
      Object.defineProperty(RegExpWrapper.create, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      RegExpMatcherWrapper = $__export("RegExpMatcherWrapper", (function() {
        var RegExpMatcherWrapper = function RegExpMatcherWrapper() {
          ;
        };
        return ($traceurRuntime.createClass)(RegExpMatcherWrapper, {}, {next: function(matcher) {
          return matcher.re.exec(matcher.input);
        }});
      }()));
      FunctionWrapper = $__export("FunctionWrapper", (function() {
        var FunctionWrapper = function FunctionWrapper() {
          ;
        };
        return ($traceurRuntime.createClass)(FunctionWrapper, {}, {apply: function(fn, posArgs) {
          assert.argumentTypes(fn, Function, posArgs, assert.type.any);
          return fn.apply(null, posArgs);
        }});
      }()));
      Object.defineProperty(FunctionWrapper.apply, "parameters", {get: function() {
        return [[Function], []];
      }});
      BaseException = $__export("BaseException", Error);
      Json = $__export("Json", _global.JSON);
      DateWrapper = $__export("DateWrapper", (function() {
        var DateWrapper = function DateWrapper() {
          ;
        };
        return ($traceurRuntime.createClass)(DateWrapper, {}, {
          fromMillis: function(ms) {
            return new Date(ms);
          },
          toMillis: function(date) {
            assert.argumentTypes(date, Date);
            return date.getTime();
          },
          now: function() {
            return new Date();
          },
          toJson: function(date) {
            return date.toJSON();
          }
        });
      }()));
      Object.defineProperty(DateWrapper.toMillis, "parameters", {get: function() {
        return [[Date]];
      }});
    }
  };
});

System.register("angular2/src/facade/collection", ["rtts_assert/rtts_assert", "angular2/src/facade/lang"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/facade/collection";
  var assert,
    int,
    isJsObject,
    global,
    List,
    Map,
    Set,
    StringMap,
    MapWrapper,
    StringMapWrapper,
    ListWrapper,
    SetWrapper;
  function isListLikeIterable(obj) {
    if (!isJsObject(obj))
      return assert.returnType((false), assert.type.boolean);
    return assert.returnType((ListWrapper.isList(obj) || (!(obj instanceof Map) && Symbol.iterator in obj)), assert.type.boolean);
  }
  function iterateListLike(obj, fn) {
    assert.argumentTypes(obj, assert.type.any, fn, Function);
    if (ListWrapper.isList(obj)) {
      for (var i = 0; i < obj.length; i++) {
        fn(obj[i]);
      }
    } else {
      var iterator = obj[Symbol.iterator]();
      var item;
      while (!((item = iterator.next()).done)) {
        fn(item.value);
      }
    }
  }
  $__export("isListLikeIterable", isListLikeIterable);
  $__export("iterateListLike", iterateListLike);
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      int = $__m.int;
      isJsObject = $__m.isJsObject;
      global = $__m.global;
    }],
    execute: function() {
      List = $__export("List", global.Array);
      Map = $__export("Map", global.Map);
      Set = $__export("Set", global.Set);
      StringMap = $__export("StringMap", global.Object);
      MapWrapper = $__export("MapWrapper", (function() {
        var MapWrapper = function MapWrapper() {
          ;
        };
        return ($traceurRuntime.createClass)(MapWrapper, {}, {
          create: function() {
            return assert.returnType((new Map()), Map);
          },
          clone: function(m) {
            assert.argumentTypes(m, Map);
            return assert.returnType((new Map(m)), Map);
          },
          createFromStringMap: function(stringMap) {
            var result = MapWrapper.create();
            for (var prop in stringMap) {
              MapWrapper.set(result, prop, stringMap[prop]);
            }
            return assert.returnType((result), Map);
          },
          createFromPairs: function(pairs) {
            assert.argumentTypes(pairs, List);
            return assert.returnType((new Map(pairs)), Map);
          },
          get: function(m, k) {
            return m.get(k);
          },
          set: function(m, k, v) {
            m.set(k, v);
          },
          contains: function(m, k) {
            return m.has(k);
          },
          forEach: function(m, fn) {
            m.forEach(fn);
          },
          size: function(m) {
            return m.size;
          },
          delete: function(m, k) {
            m.delete(k);
          },
          clear: function(m) {
            m.clear();
          },
          clearValues: function(m) {
            var keyIterator = m.keys();
            var k;
            while (!((k = keyIterator.next()).done)) {
              m.set(k.value, null);
            }
          },
          iterable: function(m) {
            return m;
          },
          keys: function(m) {
            return m.keys();
          },
          values: function(m) {
            return m.values();
          }
        });
      }()));
      Object.defineProperty(MapWrapper.clone, "parameters", {get: function() {
        return [[Map]];
      }});
      Object.defineProperty(MapWrapper.createFromPairs, "parameters", {get: function() {
        return [[List]];
      }});
      StringMapWrapper = $__export("StringMapWrapper", (function() {
        var StringMapWrapper = function StringMapWrapper() {
          ;
        };
        return ($traceurRuntime.createClass)(StringMapWrapper, {}, {
          create: function() {
            return assert.returnType(({}), Object);
          },
          contains: function(map, key) {
            return map.hasOwnProperty(key);
          },
          get: function(map, key) {
            return map.hasOwnProperty(key) ? map[key] : undefined;
          },
          set: function(map, key, value) {
            map[key] = value;
          },
          isEmpty: function(map) {
            for (var prop in map) {
              return false;
            }
            return true;
          },
          delete: function(map, key) {
            delete map[key];
          },
          forEach: function(map, callback) {
            for (var prop in map) {
              if (map.hasOwnProperty(prop)) {
                callback(map[prop], prop);
              }
            }
          },
          merge: function(m1, m2) {
            var m = {};
            for (var attr in m1) {
              if (m1.hasOwnProperty(attr)) {
                m[attr] = m1[attr];
              }
            }
            for (var attr in m2) {
              if (m2.hasOwnProperty(attr)) {
                m[attr] = m2[attr];
              }
            }
            return m;
          }
        });
      }()));
      ListWrapper = $__export("ListWrapper", (function() {
        var ListWrapper = function ListWrapper() {
          ;
        };
        return ($traceurRuntime.createClass)(ListWrapper, {}, {
          create: function() {
            return assert.returnType((new List()), List);
          },
          createFixedSize: function(size) {
            return assert.returnType((new List(size)), List);
          },
          get: function(m, k) {
            return m[k];
          },
          set: function(m, k, v) {
            m[k] = v;
          },
          clone: function(array) {
            assert.argumentTypes(array, List);
            return array.slice(0);
          },
          map: function(array, fn) {
            return array.map(fn);
          },
          forEach: function(array, fn) {
            assert.argumentTypes(array, List, fn, Function);
            for (var i = 0; i < array.length; i++) {
              fn(array[i]);
            }
          },
          push: function(array, el) {
            array.push(el);
          },
          first: function(array) {
            if (!array)
              return null;
            return array[0];
          },
          last: function(array) {
            if (!array || array.length == 0)
              return null;
            return array[array.length - 1];
          },
          find: function(list, pred) {
            assert.argumentTypes(list, List, pred, Function);
            for (var i = 0; i < list.length; ++i) {
              if (pred(list[i]))
                return list[i];
            }
            return null;
          },
          reduce: function(list, fn, init) {
            assert.argumentTypes(list, List, fn, Function, init, assert.type.any);
            return list.reduce(fn, init);
          },
          filter: function(array, pred) {
            assert.argumentTypes(array, assert.type.any, pred, Function);
            return array.filter(pred);
          },
          indexOf: function(array, value) {
            var startIndex = arguments[2] !== (void 0) ? arguments[2] : -1;
            return array.indexOf(value, startIndex);
          },
          any: function(list, pred) {
            assert.argumentTypes(list, List, pred, Function);
            for (var i = 0; i < list.length; ++i) {
              if (pred(list[i]))
                return true;
            }
            return false;
          },
          contains: function(list, el) {
            assert.argumentTypes(list, List, el, assert.type.any);
            return list.indexOf(el) !== -1;
          },
          reversed: function(array) {
            var a = ListWrapper.clone(array);
            return a.reverse();
          },
          concat: function(a, b) {
            return a.concat(b);
          },
          isList: function(list) {
            return Array.isArray(list);
          },
          insert: function(list, index, value) {
            assert.argumentTypes(list, assert.type.any, index, int, value, assert.type.any);
            list.splice(index, 0, value);
          },
          removeAt: function(list, index) {
            assert.argumentTypes(list, assert.type.any, index, int);
            var res = list[index];
            list.splice(index, 1);
            return res;
          },
          removeAll: function(list, items) {
            for (var i = 0; i < items.length; ++i) {
              var index = list.indexOf(items[i]);
              list.splice(index, 1);
            }
          },
          removeLast: function(list) {
            assert.argumentTypes(list, List);
            return list.pop();
          },
          remove: function(list, el) {
            var index = list.indexOf(el);
            if (index > -1) {
              list.splice(index, 1);
              return assert.returnType((true), assert.type.boolean);
            }
            return assert.returnType((false), assert.type.boolean);
          },
          clear: function(list) {
            list.splice(0, list.length);
          },
          join: function(list, s) {
            return list.join(s);
          },
          isEmpty: function(list) {
            return list.length == 0;
          },
          fill: function(list, value) {
            var start = arguments[2] !== (void 0) ? arguments[2] : 0;
            var end = arguments[3] !== (void 0) ? arguments[3] : null;
            assert.argumentTypes(list, List, value, assert.type.any, start, int, end, int);
            list.fill(value, start, end === null ? undefined : end);
          },
          equals: function(a, b) {
            assert.argumentTypes(a, List, b, List);
            if (a.length != b.length)
              return assert.returnType((false), assert.type.boolean);
            for (var i = 0; i < a.length; ++i) {
              if (a[i] !== b[i])
                return assert.returnType((false), assert.type.boolean);
            }
            return assert.returnType((true), assert.type.boolean);
          },
          slice: function(l, from, to) {
            assert.argumentTypes(l, List, from, int, to, int);
            return assert.returnType((l.slice(from, to)), List);
          },
          splice: function(l, from, length) {
            assert.argumentTypes(l, List, from, int, length, int);
            return assert.returnType((l.splice(from, length)), List);
          },
          sort: function(l, compareFn) {
            assert.argumentTypes(l, List, compareFn, Function);
            l.sort(compareFn);
          }
        });
      }()));
      Object.defineProperty(ListWrapper.clone, "parameters", {get: function() {
        return [[List]];
      }});
      Object.defineProperty(ListWrapper.forEach, "parameters", {get: function() {
        return [[List], [Function]];
      }});
      Object.defineProperty(ListWrapper.find, "parameters", {get: function() {
        return [[List], [Function]];
      }});
      Object.defineProperty(ListWrapper.reduce, "parameters", {get: function() {
        return [[List], [Function], []];
      }});
      Object.defineProperty(ListWrapper.filter, "parameters", {get: function() {
        return [[], [Function]];
      }});
      Object.defineProperty(ListWrapper.any, "parameters", {get: function() {
        return [[List], [Function]];
      }});
      Object.defineProperty(ListWrapper.contains, "parameters", {get: function() {
        return [[List], []];
      }});
      Object.defineProperty(ListWrapper.insert, "parameters", {get: function() {
        return [[], [int], []];
      }});
      Object.defineProperty(ListWrapper.removeAt, "parameters", {get: function() {
        return [[], [int]];
      }});
      Object.defineProperty(ListWrapper.removeLast, "parameters", {get: function() {
        return [[List]];
      }});
      Object.defineProperty(ListWrapper.fill, "parameters", {get: function() {
        return [[List], [], [int], [int]];
      }});
      Object.defineProperty(ListWrapper.equals, "parameters", {get: function() {
        return [[List], [List]];
      }});
      Object.defineProperty(ListWrapper.slice, "parameters", {get: function() {
        return [[List], [int], [int]];
      }});
      Object.defineProperty(ListWrapper.splice, "parameters", {get: function() {
        return [[List], [int], [int]];
      }});
      Object.defineProperty(ListWrapper.sort, "parameters", {get: function() {
        return [[List], [Function]];
      }});
      Object.defineProperty(iterateListLike, "parameters", {get: function() {
        return [[], [Function]];
      }});
      SetWrapper = $__export("SetWrapper", (function() {
        var SetWrapper = function SetWrapper() {
          ;
        };
        return ($traceurRuntime.createClass)(SetWrapper, {}, {
          createFromList: function(lst) {
            assert.argumentTypes(lst, List);
            return new Set(lst);
          },
          has: function(s, key) {
            assert.argumentTypes(s, Set, key, assert.type.any);
            return assert.returnType((s.has(key)), assert.type.boolean);
          }
        });
      }()));
      Object.defineProperty(SetWrapper.createFromList, "parameters", {get: function() {
        return [[List]];
      }});
      Object.defineProperty(SetWrapper.has, "parameters", {get: function() {
        return [[Set], []];
      }});
    }
  };
});

System.register("angular2/src/di/annotations", ["angular2/src/facade/lang"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/di/annotations";
  var CONST,
    Inject,
    InjectPromise,
    InjectLazy,
    Optional,
    DependencyAnnotation,
    Injectable;
  return {
    setters: [function($__m) {
      CONST = $__m.CONST;
    }],
    execute: function() {
      Inject = $__export("Inject", (function() {
        var Inject = function Inject(token) {
          this.token = token;
        };
        return ($traceurRuntime.createClass)(Inject, {}, {});
      }()));
      Object.defineProperty(Inject, "annotations", {get: function() {
        return [new CONST()];
      }});
      InjectPromise = $__export("InjectPromise", (function() {
        var InjectPromise = function InjectPromise(token) {
          this.token = token;
        };
        return ($traceurRuntime.createClass)(InjectPromise, {}, {});
      }()));
      Object.defineProperty(InjectPromise, "annotations", {get: function() {
        return [new CONST()];
      }});
      InjectLazy = $__export("InjectLazy", (function() {
        var InjectLazy = function InjectLazy(token) {
          this.token = token;
        };
        return ($traceurRuntime.createClass)(InjectLazy, {}, {});
      }()));
      Object.defineProperty(InjectLazy, "annotations", {get: function() {
        return [new CONST()];
      }});
      Optional = $__export("Optional", (function() {
        var Optional = function Optional() {};
        return ($traceurRuntime.createClass)(Optional, {}, {});
      }()));
      Object.defineProperty(Optional, "annotations", {get: function() {
        return [new CONST()];
      }});
      DependencyAnnotation = $__export("DependencyAnnotation", (function() {
        var DependencyAnnotation = function DependencyAnnotation() {};
        return ($traceurRuntime.createClass)(DependencyAnnotation, {get token() {
          return null;
        }}, {});
      }()));
      Object.defineProperty(DependencyAnnotation, "annotations", {get: function() {
        return [new CONST()];
      }});
      Injectable = $__export("Injectable", (function() {
        var Injectable = function Injectable() {};
        return ($traceurRuntime.createClass)(Injectable, {}, {});
      }()));
      Object.defineProperty(Injectable, "annotations", {get: function() {
        return [new CONST()];
      }});
    }
  };
});

System.register("angular2/src/reflection/types", [], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/reflection/types";
  var SetterFn,
    GetterFn,
    MethodFn;
  return {
    setters: [],
    execute: function() {
      SetterFn = $__export("SetterFn", Function);
      GetterFn = $__export("GetterFn", Function);
      MethodFn = $__export("MethodFn", Function);
    }
  };
});

System.register("angular2/src/reflection/reflection_capabilities", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/src/reflection/types"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/reflection/reflection_capabilities";
  var assert,
    Type,
    isPresent,
    List,
    ListWrapper,
    GetterFn,
    SetterFn,
    MethodFn,
    ReflectionCapabilities;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Type = $__m.Type;
      isPresent = $__m.isPresent;
    }, function($__m) {
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
    }, function($__m) {
      GetterFn = $__m.GetterFn;
      SetterFn = $__m.SetterFn;
      MethodFn = $__m.MethodFn;
    }],
    execute: function() {
      ReflectionCapabilities = $__export("ReflectionCapabilities", (function() {
        var ReflectionCapabilities = function ReflectionCapabilities() {
          ;
        };
        return ($traceurRuntime.createClass)(ReflectionCapabilities, {
          factory: function(type) {
            assert.argumentTypes(type, Type);
            switch (type.length) {
              case 0:
                return assert.returnType((function() {
                  return new type();
                }), Function);
              case 1:
                return assert.returnType((function(a1) {
                  return new type(a1);
                }), Function);
              case 2:
                return assert.returnType((function(a1, a2) {
                  return new type(a1, a2);
                }), Function);
              case 3:
                return assert.returnType((function(a1, a2, a3) {
                  return new type(a1, a2, a3);
                }), Function);
              case 4:
                return assert.returnType((function(a1, a2, a3, a4) {
                  return new type(a1, a2, a3, a4);
                }), Function);
              case 5:
                return assert.returnType((function(a1, a2, a3, a4, a5) {
                  return new type(a1, a2, a3, a4, a5);
                }), Function);
              case 6:
                return assert.returnType((function(a1, a2, a3, a4, a5, a6) {
                  return new type(a1, a2, a3, a4, a5, a6);
                }), Function);
              case 7:
                return assert.returnType((function(a1, a2, a3, a4, a5, a6, a7) {
                  return new type(a1, a2, a3, a4, a5, a6, a7);
                }), Function);
              case 8:
                return assert.returnType((function(a1, a2, a3, a4, a5, a6, a7, a8) {
                  return new type(a1, a2, a3, a4, a5, a6, a7, a8);
                }), Function);
              case 9:
                return assert.returnType((function(a1, a2, a3, a4, a5, a6, a7, a8, a9) {
                  return new type(a1, a2, a3, a4, a5, a6, a7, a8, a9);
                }), Function);
              case 10:
                return assert.returnType((function(a1, a2, a3, a4, a5, a6, a7, a8, a9, a10) {
                  return new type(a1, a2, a3, a4, a5, a6, a7, a8, a9, a10);
                }), Function);
            }
            ;
            throw new Error("Factory cannot take more than 10 arguments");
          },
          parameters: function(typeOfFunc) {
            if (window.Reflect && !typeOfFunc.parameters) {
              var reflect = window.Reflect.getMetadata('design:paramtypes', typeOfFunc);
              if (reflect) {
                reflect = reflect.map((function(p) {
                  return [p];
                }));
              } else {
                reflect = ListWrapper.createFixedSize(typeOfFunc.length);
              }
              return assert.returnType((reflect), assert.genericType(List, List));
            }
            return assert.returnType((isPresent(typeOfFunc.parameters) ? typeOfFunc.parameters : ListWrapper.createFixedSize(typeOfFunc.length)), assert.genericType(List, List));
          },
          annotations: function(typeOfFunc) {
            if (isPresent(typeOfFunc.annotations)) {
              return assert.returnType((typeOfFunc.annotations), List);
            }
            if (window.Reflect) {
              return assert.returnType((window.Reflect.getMetadata('annotations', typeOfFunc)), List);
            }
            return assert.returnType(([]), List);
          },
          getter: function(name) {
            assert.argumentTypes(name, assert.type.string);
            return assert.returnType((new Function('o', 'return o.' + name + ';')), GetterFn);
          },
          setter: function(name) {
            assert.argumentTypes(name, assert.type.string);
            return assert.returnType((new Function('o', 'v', 'return o.' + name + ' = v;')), SetterFn);
          },
          method: function(name) {
            assert.argumentTypes(name, assert.type.string);
            var method = ("o." + name);
            return assert.returnType((new Function('o', 'args', ("if (!" + method + ") throw new Error('\"" + name + "\" is undefined');") + ("return " + method + ".apply(o, args);"))), MethodFn);
          }
        }, {});
      }()));
      Object.defineProperty(ReflectionCapabilities.prototype.factory, "parameters", {get: function() {
        return [[Type]];
      }});
      Object.defineProperty(ReflectionCapabilities.prototype.getter, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(ReflectionCapabilities.prototype.setter, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(ReflectionCapabilities.prototype.method, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
    }
  };
});

System.register("angular2/src/di/key", ["rtts_assert/rtts_assert", "angular2/src/facade/collection"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/di/key";
  var assert,
    MapWrapper,
    Key,
    KeyRegistry,
    _globalKeyRegistry;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      MapWrapper = $__m.MapWrapper;
    }],
    execute: function() {
      Key = $__export("Key", (function() {
        var Key = function Key(token, id) {
          this.token = token;
          this.id = id;
          this.metadata = null;
        };
        return ($traceurRuntime.createClass)(Key, {}, {
          get: function(token) {
            return assert.returnType((_globalKeyRegistry.get(token)), Key);
          },
          get numberOfKeys() {
            return _globalKeyRegistry.numberOfKeys;
          }
        });
      }()));
      KeyRegistry = $__export("KeyRegistry", (function() {
        var KeyRegistry = function KeyRegistry() {
          this._allKeys = MapWrapper.create();
        };
        return ($traceurRuntime.createClass)(KeyRegistry, {
          get: function(token) {
            if (token instanceof Key)
              return assert.returnType((token), Key);
            if (MapWrapper.contains(this._allKeys, token)) {
              return assert.returnType((MapWrapper.get(this._allKeys, token)), Key);
            }
            var newKey = new Key(token, Key.numberOfKeys);
            MapWrapper.set(this._allKeys, token, newKey);
            return assert.returnType((newKey), Key);
          },
          get numberOfKeys() {
            return MapWrapper.size(this._allKeys);
          }
        }, {});
      }()));
      _globalKeyRegistry = new KeyRegistry();
    }
  };
});

System.register("angular2/src/di/exceptions", ["rtts_assert/rtts_assert", "angular2/src/facade/collection", "angular2/src/facade/lang"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/di/exceptions";
  var assert,
    ListWrapper,
    List,
    stringify,
    AbstractBindingError,
    NoBindingError,
    AsyncBindingError,
    CyclicDependencyError,
    InstantiationError,
    InvalidBindingError,
    NoAnnotationError;
  function findFirstClosedCycle(keys) {
    assert.argumentTypes(keys, List);
    var res = [];
    for (var i = 0; i < keys.length; ++i) {
      if (ListWrapper.contains(res, keys[i])) {
        ListWrapper.push(res, keys[i]);
        return res;
      } else {
        ListWrapper.push(res, keys[i]);
      }
    }
    return res;
  }
  function constructResolvingPath(keys) {
    if (keys.length > 1) {
      var reversed = findFirstClosedCycle(ListWrapper.reversed(keys));
      var tokenStrs = ListWrapper.map(reversed, (function(k) {
        return stringify(k.token);
      }));
      return " (" + tokenStrs.join(' -> ') + ")";
    } else {
      return "";
    }
  }
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      ListWrapper = $__m.ListWrapper;
      List = $__m.List;
    }, function($__m) {
      stringify = $__m.stringify;
    }],
    execute: function() {
      Object.defineProperty(findFirstClosedCycle, "parameters", {get: function() {
        return [[List]];
      }});
      Object.defineProperty(constructResolvingPath, "parameters", {get: function() {
        return [[List]];
      }});
      AbstractBindingError = $__export("AbstractBindingError", (function($__super) {
        var AbstractBindingError = function AbstractBindingError(key, constructResolvingMessage) {
          assert.argumentTypes(key, assert.type.any, constructResolvingMessage, Function);
          $traceurRuntime.superConstructor(AbstractBindingError).call(this);
          this.keys = [key];
          this.constructResolvingMessage = constructResolvingMessage;
          this.message = this.constructResolvingMessage(this.keys);
        };
        return ($traceurRuntime.createClass)(AbstractBindingError, {
          addKey: function(key) {
            ListWrapper.push(this.keys, key);
            this.message = this.constructResolvingMessage(this.keys);
          },
          toString: function() {
            return this.message;
          }
        }, {}, $__super);
      }(Error)));
      Object.defineProperty(AbstractBindingError, "parameters", {get: function() {
        return [[], [Function]];
      }});
      NoBindingError = $__export("NoBindingError", (function($__super) {
        var NoBindingError = function NoBindingError(key) {
          $traceurRuntime.superConstructor(NoBindingError).call(this, key, function(keys) {
            assert.argumentTypes(keys, List);
            var first = stringify(ListWrapper.first(keys).token);
            return ("No provider for " + first + "!" + constructResolvingPath(keys));
          });
        };
        return ($traceurRuntime.createClass)(NoBindingError, {}, {}, $__super);
      }(AbstractBindingError)));
      AsyncBindingError = $__export("AsyncBindingError", (function($__super) {
        var AsyncBindingError = function AsyncBindingError(key) {
          $traceurRuntime.superConstructor(AsyncBindingError).call(this, key, function(keys) {
            assert.argumentTypes(keys, List);
            var first = stringify(ListWrapper.first(keys).token);
            return ("Cannot instantiate " + first + " synchronously. ") + ("It is provided as a promise!" + constructResolvingPath(keys));
          });
        };
        return ($traceurRuntime.createClass)(AsyncBindingError, {}, {}, $__super);
      }(AbstractBindingError)));
      CyclicDependencyError = $__export("CyclicDependencyError", (function($__super) {
        var CyclicDependencyError = function CyclicDependencyError(key) {
          $traceurRuntime.superConstructor(CyclicDependencyError).call(this, key, function(keys) {
            assert.argumentTypes(keys, List);
            return ("Cannot instantiate cyclic dependency!" + constructResolvingPath(keys));
          });
        };
        return ($traceurRuntime.createClass)(CyclicDependencyError, {}, {}, $__super);
      }(AbstractBindingError)));
      InstantiationError = $__export("InstantiationError", (function($__super) {
        var InstantiationError = function InstantiationError(originalException, key) {
          $traceurRuntime.superConstructor(InstantiationError).call(this, key, function(keys) {
            assert.argumentTypes(keys, List);
            var first = stringify(ListWrapper.first(keys).token);
            return ("Error during instantiation of " + first + "!" + constructResolvingPath(keys) + ".") + (" ORIGINAL ERROR: " + originalException);
          });
        };
        return ($traceurRuntime.createClass)(InstantiationError, {}, {}, $__super);
      }(AbstractBindingError)));
      InvalidBindingError = $__export("InvalidBindingError", (function($__super) {
        var InvalidBindingError = function InvalidBindingError(binding) {
          $traceurRuntime.superConstructor(InvalidBindingError).call(this);
          this.message = ("Invalid binding " + binding);
        };
        return ($traceurRuntime.createClass)(InvalidBindingError, {toString: function() {
          return this.message;
        }}, {}, $__super);
      }(Error)));
      NoAnnotationError = $__export("NoAnnotationError", (function($__super) {
        var NoAnnotationError = function NoAnnotationError(typeOrFunc) {
          $traceurRuntime.superConstructor(NoAnnotationError).call(this);
          this.message = ("Cannot resolve all parameters for " + stringify(typeOrFunc) + ".") + " Make sure they all have valid type or annotations.";
        };
        return ($traceurRuntime.createClass)(NoAnnotationError, {toString: function() {
          return this.message;
        }}, {}, $__super);
      }(Error)));
    }
  };
});

System.register("angular2/src/di/opaque_token", ["rtts_assert/rtts_assert"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/di/opaque_token";
  var assert,
    OpaqueToken;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }],
    execute: function() {
      OpaqueToken = $__export("OpaqueToken", (function() {
        var OpaqueToken = function OpaqueToken(desc) {
          assert.argumentTypes(desc, assert.type.string);
          this._desc = ("Token(" + desc + ")");
        };
        return ($traceurRuntime.createClass)(OpaqueToken, {toString: function() {
          return this._desc;
        }}, {});
      }()));
      Object.defineProperty(OpaqueToken, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
    }
  };
});

System.register("angular2/src/change_detection/parser/parser", ["rtts_assert/rtts_assert", "angular2/di", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/src/change_detection/parser/lexer", "angular2/src/reflection/reflection", "angular2/src/change_detection/parser/ast"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/parser/parser";
  var assert,
    Injectable,
    int,
    isBlank,
    isPresent,
    BaseException,
    StringWrapper,
    RegExpWrapper,
    ListWrapper,
    List,
    Lexer,
    EOF,
    Token,
    $PERIOD,
    $COLON,
    $SEMICOLON,
    $LBRACKET,
    $RBRACKET,
    $COMMA,
    $LBRACE,
    $RBRACE,
    $LPAREN,
    $RPAREN,
    reflector,
    Reflector,
    AST,
    EmptyExpr,
    ImplicitReceiver,
    AccessMember,
    LiteralPrimitive,
    Expression,
    Binary,
    PrefixNot,
    Conditional,
    Pipe,
    Assignment,
    Chain,
    KeyedAccess,
    LiteralArray,
    LiteralMap,
    Interpolation,
    MethodCall,
    FunctionCall,
    TemplateBindings,
    TemplateBinding,
    ASTWithSource,
    _implicitReceiver,
    INTERPOLATION_REGEXP,
    QUOTE_REGEXP,
    Parser,
    _ParseAST;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      int = $__m.int;
      isBlank = $__m.isBlank;
      isPresent = $__m.isPresent;
      BaseException = $__m.BaseException;
      StringWrapper = $__m.StringWrapper;
      RegExpWrapper = $__m.RegExpWrapper;
    }, function($__m) {
      ListWrapper = $__m.ListWrapper;
      List = $__m.List;
    }, function($__m) {
      Lexer = $__m.Lexer;
      EOF = $__m.EOF;
      Token = $__m.Token;
      $PERIOD = $__m.$PERIOD;
      $COLON = $__m.$COLON;
      $SEMICOLON = $__m.$SEMICOLON;
      $LBRACKET = $__m.$LBRACKET;
      $RBRACKET = $__m.$RBRACKET;
      $COMMA = $__m.$COMMA;
      $LBRACE = $__m.$LBRACE;
      $RBRACE = $__m.$RBRACE;
      $LPAREN = $__m.$LPAREN;
      $RPAREN = $__m.$RPAREN;
    }, function($__m) {
      reflector = $__m.reflector;
      Reflector = $__m.Reflector;
    }, function($__m) {
      AST = $__m.AST;
      EmptyExpr = $__m.EmptyExpr;
      ImplicitReceiver = $__m.ImplicitReceiver;
      AccessMember = $__m.AccessMember;
      LiteralPrimitive = $__m.LiteralPrimitive;
      Expression = $__m.Expression;
      Binary = $__m.Binary;
      PrefixNot = $__m.PrefixNot;
      Conditional = $__m.Conditional;
      Pipe = $__m.Pipe;
      Assignment = $__m.Assignment;
      Chain = $__m.Chain;
      KeyedAccess = $__m.KeyedAccess;
      LiteralArray = $__m.LiteralArray;
      LiteralMap = $__m.LiteralMap;
      Interpolation = $__m.Interpolation;
      MethodCall = $__m.MethodCall;
      FunctionCall = $__m.FunctionCall;
      TemplateBindings = $__m.TemplateBindings;
      TemplateBinding = $__m.TemplateBinding;
      ASTWithSource = $__m.ASTWithSource;
    }],
    execute: function() {
      _implicitReceiver = new ImplicitReceiver();
      INTERPOLATION_REGEXP = RegExpWrapper.create('\\{\\{(.*?)\\}\\}');
      QUOTE_REGEXP = RegExpWrapper.create("'");
      Parser = $__export("Parser", (function() {
        var Parser = function Parser(lexer) {
          var providedReflector = arguments[1] !== (void 0) ? arguments[1] : null;
          assert.argumentTypes(lexer, Lexer, providedReflector, Reflector);
          this._lexer = lexer;
          this._reflector = isPresent(providedReflector) ? providedReflector : reflector;
        };
        return ($traceurRuntime.createClass)(Parser, {
          parseAction: function(input, location) {
            assert.argumentTypes(input, assert.type.string, location, assert.type.any);
            var tokens = this._lexer.tokenize(input);
            var ast = new _ParseAST(input, location, tokens, this._reflector, true).parseChain();
            return assert.returnType((new ASTWithSource(ast, input, location)), ASTWithSource);
          },
          parseBinding: function(input, location) {
            assert.argumentTypes(input, assert.type.string, location, assert.type.any);
            var tokens = this._lexer.tokenize(input);
            var ast = new _ParseAST(input, location, tokens, this._reflector, false).parseChain();
            return assert.returnType((new ASTWithSource(ast, input, location)), ASTWithSource);
          },
          addPipes: function(bindingAst, pipes) {
            if (ListWrapper.isEmpty(pipes))
              return assert.returnType((bindingAst), ASTWithSource);
            var res = ListWrapper.reduce(pipes, (function(result, currentPipeName) {
              return new Pipe(result, currentPipeName, [], false);
            }), bindingAst.ast);
            return assert.returnType((new ASTWithSource(res, bindingAst.source, bindingAst.location)), ASTWithSource);
          },
          parseTemplateBindings: function(input, location) {
            assert.argumentTypes(input, assert.type.string, location, assert.type.any);
            var tokens = this._lexer.tokenize(input);
            return assert.returnType((new _ParseAST(input, location, tokens, this._reflector, false).parseTemplateBindings()), assert.genericType(List, TemplateBinding));
          },
          parseInterpolation: function(input, location) {
            assert.argumentTypes(input, assert.type.string, location, assert.type.any);
            var parts = StringWrapper.split(input, INTERPOLATION_REGEXP);
            if (parts.length <= 1) {
              return assert.returnType((null), ASTWithSource);
            }
            var strings = [];
            var expressions = [];
            for (var i = 0; i < parts.length; i++) {
              var part = parts[i];
              if (i % 2 === 0) {
                ListWrapper.push(strings, part);
              } else {
                var tokens = this._lexer.tokenize(part);
                var ast = new _ParseAST(input, location, tokens, this._reflector, false).parseChain();
                ListWrapper.push(expressions, ast);
              }
            }
            return assert.returnType((new ASTWithSource(new Interpolation(strings, expressions), input, location)), ASTWithSource);
          },
          wrapLiteralPrimitive: function(input, location) {
            assert.argumentTypes(input, assert.type.string, location, assert.type.any);
            return assert.returnType((new ASTWithSource(new LiteralPrimitive(input), input, location)), ASTWithSource);
          }
        }, {});
      }()));
      Object.defineProperty(Parser, "annotations", {get: function() {
        return [new Injectable()];
      }});
      Object.defineProperty(Parser, "parameters", {get: function() {
        return [[Lexer], [Reflector]];
      }});
      Object.defineProperty(Parser.prototype.parseAction, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.any]];
      }});
      Object.defineProperty(Parser.prototype.parseBinding, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.any]];
      }});
      Object.defineProperty(Parser.prototype.addPipes, "parameters", {get: function() {
        return [[ASTWithSource], [assert.genericType(List, String)]];
      }});
      Object.defineProperty(Parser.prototype.parseTemplateBindings, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.any]];
      }});
      Object.defineProperty(Parser.prototype.parseInterpolation, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.any]];
      }});
      Object.defineProperty(Parser.prototype.wrapLiteralPrimitive, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.any]];
      }});
      _ParseAST = (function() {
        var _ParseAST = function _ParseAST(input, location, tokens, reflector, parseAction) {
          assert.argumentTypes(input, assert.type.string, location, assert.type.any, tokens, List, reflector, Reflector, parseAction, assert.type.boolean);
          this.input = input;
          this.location = location;
          this.tokens = tokens;
          this.index = 0;
          this.reflector = reflector;
          this.parseAction = parseAction;
        };
        return ($traceurRuntime.createClass)(_ParseAST, {
          peek: function(offset) {
            assert.argumentTypes(offset, int);
            var i = this.index + offset;
            return assert.returnType((i < this.tokens.length ? this.tokens[i] : EOF), Token);
          },
          get next() {
            return assert.returnType((this.peek(0)), Token);
          },
          get inputIndex() {
            return assert.returnType(((this.index < this.tokens.length) ? this.next.index : this.input.length), int);
          },
          advance: function() {
            this.index++;
          },
          optionalCharacter: function(code) {
            assert.argumentTypes(code, int);
            if (this.next.isCharacter(code)) {
              this.advance();
              return assert.returnType((true), assert.type.boolean);
            } else {
              return assert.returnType((false), assert.type.boolean);
            }
          },
          optionalKeywordVar: function() {
            if (this.peekKeywordVar()) {
              this.advance();
              return assert.returnType((true), assert.type.boolean);
            } else {
              return assert.returnType((false), assert.type.boolean);
            }
          },
          peekKeywordVar: function() {
            return assert.returnType((this.next.isKeywordVar() || this.next.isOperator('#')), assert.type.boolean);
          },
          expectCharacter: function(code) {
            assert.argumentTypes(code, int);
            if (this.optionalCharacter(code))
              return ;
            this.error(("Missing expected " + StringWrapper.fromCharCode(code)));
          },
          optionalOperator: function(op) {
            assert.argumentTypes(op, assert.type.string);
            if (this.next.isOperator(op)) {
              this.advance();
              return assert.returnType((true), assert.type.boolean);
            } else {
              return assert.returnType((false), assert.type.boolean);
            }
          },
          expectOperator: function(operator) {
            assert.argumentTypes(operator, assert.type.string);
            if (this.optionalOperator(operator))
              return ;
            this.error(("Missing expected operator " + operator));
          },
          expectIdentifierOrKeyword: function() {
            var n = this.next;
            if (!n.isIdentifier() && !n.isKeyword()) {
              this.error(("Unexpected token " + n + ", expected identifier or keyword"));
            }
            this.advance();
            return assert.returnType((n.toString()), assert.type.string);
          },
          expectIdentifierOrKeywordOrString: function() {
            var n = this.next;
            if (!n.isIdentifier() && !n.isKeyword() && !n.isString()) {
              this.error(("Unexpected token " + n + ", expected identifier, keyword, or string"));
            }
            this.advance();
            return assert.returnType((n.toString()), assert.type.string);
          },
          parseChain: function() {
            var exprs = [];
            while (this.index < this.tokens.length) {
              var expr = this.parsePipe();
              ListWrapper.push(exprs, expr);
              if (this.optionalCharacter($SEMICOLON)) {
                if (!this.parseAction) {
                  this.error("Binding expression cannot contain chained expression");
                }
                while (this.optionalCharacter($SEMICOLON)) {}
              } else if (this.index < this.tokens.length) {
                this.error(("Unexpected token '" + this.next + "'"));
              }
            }
            if (exprs.length == 0)
              return assert.returnType((new EmptyExpr()), AST);
            if (exprs.length == 1)
              return assert.returnType((exprs[0]), AST);
            return assert.returnType((new Chain(exprs)), AST);
          },
          parsePipe: function() {
            var result = this.parseExpression();
            if (this.optionalOperator("|")) {
              return this.parseInlinedPipe(result);
            } else {
              return result;
            }
          },
          parseExpression: function() {
            var start = this.inputIndex;
            var result = this.parseConditional();
            while (this.next.isOperator('=')) {
              if (!result.isAssignable) {
                var end = this.inputIndex;
                var expression = this.input.substring(start, end);
                this.error(("Expression " + expression + " is not assignable"));
              }
              if (!this.parseAction) {
                this.error("Binding expression cannot contain assignments");
              }
              this.expectOperator('=');
              result = new Assignment(result, this.parseConditional());
            }
            return result;
          },
          parseConditional: function() {
            var start = this.inputIndex;
            var result = this.parseLogicalOr();
            if (this.optionalOperator('?')) {
              var yes = this.parseExpression();
              if (!this.optionalCharacter($COLON)) {
                var end = this.inputIndex;
                var expression = this.input.substring(start, end);
                this.error(("Conditional expression " + expression + " requires all 3 expressions"));
              }
              var no = this.parseExpression();
              return new Conditional(result, yes, no);
            } else {
              return result;
            }
          },
          parseLogicalOr: function() {
            var result = this.parseLogicalAnd();
            while (this.optionalOperator('||')) {
              result = new Binary('||', result, this.parseLogicalAnd());
            }
            return result;
          },
          parseLogicalAnd: function() {
            var result = this.parseEquality();
            while (this.optionalOperator('&&')) {
              result = new Binary('&&', result, this.parseEquality());
            }
            return result;
          },
          parseEquality: function() {
            var result = this.parseRelational();
            while (true) {
              if (this.optionalOperator('==')) {
                result = new Binary('==', result, this.parseRelational());
              } else if (this.optionalOperator('!=')) {
                result = new Binary('!=', result, this.parseRelational());
              } else {
                return result;
              }
            }
          },
          parseRelational: function() {
            var result = this.parseAdditive();
            while (true) {
              if (this.optionalOperator('<')) {
                result = new Binary('<', result, this.parseAdditive());
              } else if (this.optionalOperator('>')) {
                result = new Binary('>', result, this.parseAdditive());
              } else if (this.optionalOperator('<=')) {
                result = new Binary('<=', result, this.parseAdditive());
              } else if (this.optionalOperator('>=')) {
                result = new Binary('>=', result, this.parseAdditive());
              } else {
                return result;
              }
            }
          },
          parseAdditive: function() {
            var result = this.parseMultiplicative();
            while (true) {
              if (this.optionalOperator('+')) {
                result = new Binary('+', result, this.parseMultiplicative());
              } else if (this.optionalOperator('-')) {
                result = new Binary('-', result, this.parseMultiplicative());
              } else {
                return result;
              }
            }
          },
          parseMultiplicative: function() {
            var result = this.parsePrefix();
            while (true) {
              if (this.optionalOperator('*')) {
                result = new Binary('*', result, this.parsePrefix());
              } else if (this.optionalOperator('%')) {
                result = new Binary('%', result, this.parsePrefix());
              } else if (this.optionalOperator('/')) {
                result = new Binary('/', result, this.parsePrefix());
              } else {
                return result;
              }
            }
          },
          parsePrefix: function() {
            if (this.optionalOperator('+')) {
              return this.parsePrefix();
            } else if (this.optionalOperator('-')) {
              return new Binary('-', new LiteralPrimitive(0), this.parsePrefix());
            } else if (this.optionalOperator('!')) {
              return new PrefixNot(this.parsePrefix());
            } else {
              return this.parseCallChain();
            }
          },
          parseCallChain: function() {
            var result = this.parsePrimary();
            while (true) {
              if (this.optionalCharacter($PERIOD)) {
                result = this.parseAccessMemberOrMethodCall(result);
              } else if (this.optionalCharacter($LBRACKET)) {
                var key = this.parseExpression();
                this.expectCharacter($RBRACKET);
                result = new KeyedAccess(result, key);
              } else if (this.optionalCharacter($LPAREN)) {
                var args = this.parseCallArguments();
                this.expectCharacter($RPAREN);
                result = new FunctionCall(result, args);
              } else {
                return assert.returnType((result), AST);
              }
            }
          },
          parsePrimary: function() {
            if (this.optionalCharacter($LPAREN)) {
              var result = this.parsePipe();
              this.expectCharacter($RPAREN);
              return result;
            } else if (this.next.isKeywordNull() || this.next.isKeywordUndefined()) {
              this.advance();
              return new LiteralPrimitive(null);
            } else if (this.next.isKeywordTrue()) {
              this.advance();
              return new LiteralPrimitive(true);
            } else if (this.next.isKeywordFalse()) {
              this.advance();
              return new LiteralPrimitive(false);
            } else if (this.optionalCharacter($LBRACKET)) {
              var elements = this.parseExpressionList($RBRACKET);
              this.expectCharacter($RBRACKET);
              return new LiteralArray(elements);
            } else if (this.next.isCharacter($LBRACE)) {
              return this.parseLiteralMap();
            } else if (this.next.isIdentifier()) {
              return this.parseAccessMemberOrMethodCall(_implicitReceiver);
            } else if (this.next.isNumber()) {
              var value = this.next.toNumber();
              this.advance();
              return new LiteralPrimitive(value);
            } else if (this.next.isString()) {
              var value = this.next.toString();
              this.advance();
              return new LiteralPrimitive(value);
            } else if (this.index >= this.tokens.length) {
              this.error(("Unexpected end of expression: " + this.input));
            } else {
              this.error(("Unexpected token " + this.next));
            }
          },
          parseExpressionList: function(terminator) {
            assert.argumentTypes(terminator, int);
            var result = [];
            if (!this.next.isCharacter(terminator)) {
              do {
                ListWrapper.push(result, this.parseExpression());
              } while (this.optionalCharacter($COMMA));
            }
            return assert.returnType((result), List);
          },
          parseLiteralMap: function() {
            var keys = [];
            var values = [];
            this.expectCharacter($LBRACE);
            if (!this.optionalCharacter($RBRACE)) {
              do {
                var key = this.expectIdentifierOrKeywordOrString();
                ListWrapper.push(keys, key);
                this.expectCharacter($COLON);
                ListWrapper.push(values, this.parseExpression());
              } while (this.optionalCharacter($COMMA));
              this.expectCharacter($RBRACE);
            }
            return new LiteralMap(keys, values);
          },
          parseAccessMemberOrMethodCall: function(receiver) {
            var id = this.expectIdentifierOrKeyword();
            if (this.optionalCharacter($LPAREN)) {
              var args = this.parseCallArguments();
              this.expectCharacter($RPAREN);
              var fn = this.reflector.method(id);
              return assert.returnType((new MethodCall(receiver, id, fn, args)), AST);
            } else {
              var getter = this.reflector.getter(id);
              var setter = this.reflector.setter(id);
              var am = new AccessMember(receiver, id, getter, setter);
              if (this.optionalOperator("|")) {
                return assert.returnType((this.parseInlinedPipe(am)), AST);
              } else {
                return assert.returnType((am), AST);
              }
            }
          },
          parseInlinedPipe: function(result) {
            do {
              if (this.parseAction) {
                this.error("Cannot have a pipe in an action expression");
              }
              var name = this.expectIdentifierOrKeyword();
              var args = ListWrapper.create();
              while (this.optionalCharacter($COLON)) {
                ListWrapper.push(args, this.parseExpression());
              }
              result = new Pipe(result, name, args, true);
            } while (this.optionalOperator("|"));
            return result;
          },
          parseCallArguments: function() {
            if (this.next.isCharacter($RPAREN))
              return [];
            var positionals = [];
            do {
              ListWrapper.push(positionals, this.parseExpression());
            } while (this.optionalCharacter($COMMA));
            return positionals;
          },
          expectTemplateBindingKey: function() {
            var result = '';
            var operatorFound = false;
            do {
              result += this.expectIdentifierOrKeywordOrString();
              operatorFound = this.optionalOperator('-');
              if (operatorFound) {
                result += '-';
              }
            } while (operatorFound);
            return result.toString();
          },
          parseTemplateBindings: function() {
            var bindings = [];
            while (this.index < this.tokens.length) {
              var keyIsVar = assert.type(this.optionalKeywordVar(), assert.type.boolean);
              var key = this.expectTemplateBindingKey();
              this.optionalCharacter($COLON);
              var name = null;
              var expression = null;
              if (this.next !== EOF) {
                if (keyIsVar) {
                  if (this.optionalOperator("=")) {
                    name = this.expectTemplateBindingKey();
                  } else {
                    name = '\$implicit';
                  }
                } else if (!this.peekKeywordVar()) {
                  var start = this.inputIndex;
                  var ast = this.parsePipe();
                  var source = this.input.substring(start, this.inputIndex);
                  expression = new ASTWithSource(ast, source, this.location);
                }
              }
              ListWrapper.push(bindings, new TemplateBinding(key, keyIsVar, name, expression));
              if (!this.optionalCharacter($SEMICOLON)) {
                this.optionalCharacter($COMMA);
              }
              ;
            }
            return bindings;
          },
          error: function(message) {
            var index = arguments[1] !== (void 0) ? arguments[1] : null;
            assert.argumentTypes(message, assert.type.string, index, int);
            if (isBlank(index))
              index = this.index;
            var location = (index < this.tokens.length) ? ("at column " + (this.tokens[index].index + 1) + " in") : "at the end of the expression";
            throw new BaseException(("Parser Error: " + message + " " + location + " [" + this.input + "] in " + this.location));
          }
        }, {});
      }());
      Object.defineProperty(_ParseAST, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.any], [List], [Reflector], [assert.type.boolean]];
      }});
      Object.defineProperty(_ParseAST.prototype.peek, "parameters", {get: function() {
        return [[int]];
      }});
      Object.defineProperty(_ParseAST.prototype.optionalCharacter, "parameters", {get: function() {
        return [[int]];
      }});
      Object.defineProperty(_ParseAST.prototype.expectCharacter, "parameters", {get: function() {
        return [[int]];
      }});
      Object.defineProperty(_ParseAST.prototype.optionalOperator, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(_ParseAST.prototype.expectOperator, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(_ParseAST.prototype.parseExpressionList, "parameters", {get: function() {
        return [[int]];
      }});
      Object.defineProperty(_ParseAST.prototype.error, "parameters", {get: function() {
        return [[assert.type.string], [int]];
      }});
    }
  };
});

System.register("angular2/src/change_detection/parser/locals", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/collection"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/parser/locals";
  var assert,
    isPresent,
    BaseException,
    ListWrapper,
    MapWrapper,
    Locals;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isPresent = $__m.isPresent;
      BaseException = $__m.BaseException;
    }, function($__m) {
      ListWrapper = $__m.ListWrapper;
      MapWrapper = $__m.MapWrapper;
    }],
    execute: function() {
      Locals = $__export("Locals", (function() {
        var Locals = function Locals(parent, current) {
          assert.argumentTypes(parent, Locals, current, Map);
          this.parent = parent;
          this.current = current;
        };
        return ($traceurRuntime.createClass)(Locals, {
          contains: function(name) {
            assert.argumentTypes(name, assert.type.string);
            if (MapWrapper.contains(this.current, name)) {
              return assert.returnType((true), assert.type.boolean);
            }
            if (isPresent(this.parent)) {
              return assert.returnType((this.parent.contains(name)), assert.type.boolean);
            }
            return assert.returnType((false), assert.type.boolean);
          },
          get: function(name) {
            assert.argumentTypes(name, assert.type.string);
            if (MapWrapper.contains(this.current, name)) {
              return MapWrapper.get(this.current, name);
            }
            if (isPresent(this.parent)) {
              return this.parent.get(name);
            }
            throw new BaseException(("Cannot find '" + name + "'"));
          },
          set: function(name, value) {
            assert.argumentTypes(name, assert.type.string, value, assert.type.any);
            if (MapWrapper.contains(this.current, name)) {
              MapWrapper.set(this.current, name, value);
            } else {
              throw new BaseException('Setting of new keys post-construction is not supported.');
            }
          },
          clearValues: function() {
            MapWrapper.clearValues(this.current);
          }
        }, {});
      }()));
      Object.defineProperty(Locals, "parameters", {get: function() {
        return [[Locals], [Map]];
      }});
      Object.defineProperty(Locals.prototype.contains, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(Locals.prototype.get, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(Locals.prototype.set, "parameters", {get: function() {
        return [[assert.type.string], []];
      }});
    }
  };
});

System.register("angular2/src/change_detection/constants", [], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/constants";
  var CHECK_ONCE,
    CHECKED,
    CHECK_ALWAYS,
    DETACHED,
    ON_PUSH,
    DEFAULT;
  return {
    setters: [],
    execute: function() {
      CHECK_ONCE = $__export("CHECK_ONCE", "CHECK_ONCE");
      CHECKED = $__export("CHECKED", "CHECKED");
      CHECK_ALWAYS = $__export("CHECK_ALWAYS", "ALWAYS_CHECK");
      DETACHED = $__export("DETACHED", "DETACHED");
      ON_PUSH = $__export("ON_PUSH", "ON_PUSH");
      DEFAULT = $__export("DEFAULT", "DEFAULT");
    }
  };
});

System.register("angular2/src/change_detection/interfaces", ["rtts_assert/rtts_assert", "angular2/src/facade/collection", "angular2/src/change_detection/parser/locals", "angular2/src/change_detection/constants", "angular2/src/change_detection/binding_record"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/interfaces";
  var assert,
    List,
    Locals,
    DEFAULT,
    BindingRecord,
    ProtoChangeDetector,
    ChangeDetection,
    ChangeDispatcher,
    ChangeDetector;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      List = $__m.List;
    }, function($__m) {
      Locals = $__m.Locals;
    }, function($__m) {
      DEFAULT = $__m.DEFAULT;
    }, function($__m) {
      BindingRecord = $__m.BindingRecord;
    }],
    execute: function() {
      ProtoChangeDetector = $__export("ProtoChangeDetector", (function() {
        var ProtoChangeDetector = function ProtoChangeDetector() {
          ;
        };
        return ($traceurRuntime.createClass)(ProtoChangeDetector, {instantiate: function(dispatcher, bindingRecords, variableBindings, directiveRecords) {
          assert.argumentTypes(dispatcher, assert.type.any, bindingRecords, List, variableBindings, List, directiveRecords, List);
          return assert.returnType((null), ChangeDetector);
        }}, {});
      }()));
      Object.defineProperty(ProtoChangeDetector.prototype.instantiate, "parameters", {get: function() {
        return [[assert.type.any], [List], [List], [List]];
      }});
      ChangeDetection = $__export("ChangeDetection", (function() {
        var ChangeDetection = function ChangeDetection() {
          ;
        };
        return ($traceurRuntime.createClass)(ChangeDetection, {createProtoChangeDetector: function(name) {
          var changeControlStrategy = arguments[1] !== (void 0) ? arguments[1] : DEFAULT;
          assert.argumentTypes(name, assert.type.string, changeControlStrategy, assert.type.string);
          return assert.returnType((null), ProtoChangeDetector);
        }}, {});
      }()));
      Object.defineProperty(ChangeDetection.prototype.createProtoChangeDetector, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      ChangeDispatcher = $__export("ChangeDispatcher", (function() {
        var ChangeDispatcher = function ChangeDispatcher() {
          ;
        };
        return ($traceurRuntime.createClass)(ChangeDispatcher, {notifyOnBinding: function(bindingRecord, value) {
          assert.argumentTypes(bindingRecord, BindingRecord, value, assert.type.any);
        }}, {});
      }()));
      Object.defineProperty(ChangeDispatcher.prototype.notifyOnBinding, "parameters", {get: function() {
        return [[BindingRecord], [assert.type.any]];
      }});
      ChangeDetector = $__export("ChangeDetector", (function() {
        var ChangeDetector = function ChangeDetector() {
          ;
        };
        return ($traceurRuntime.createClass)(ChangeDetector, {
          addChild: function(cd) {
            assert.argumentTypes(cd, ChangeDetector);
          },
          addShadowDomChild: function(cd) {
            assert.argumentTypes(cd, ChangeDetector);
          },
          removeChild: function(cd) {
            assert.argumentTypes(cd, ChangeDetector);
          },
          removeShadowDomChild: function(cd) {
            assert.argumentTypes(cd, ChangeDetector);
          },
          remove: function() {},
          hydrate: function(context, locals, directives) {
            assert.argumentTypes(context, assert.type.any, locals, Locals, directives, assert.type.any);
          },
          dehydrate: function() {},
          markPathToRootAsCheckOnce: function() {},
          detectChanges: function() {},
          checkNoChanges: function() {}
        }, {});
      }()));
      Object.defineProperty(ChangeDetector.prototype.addChild, "parameters", {get: function() {
        return [[ChangeDetector]];
      }});
      Object.defineProperty(ChangeDetector.prototype.addShadowDomChild, "parameters", {get: function() {
        return [[ChangeDetector]];
      }});
      Object.defineProperty(ChangeDetector.prototype.removeChild, "parameters", {get: function() {
        return [[ChangeDetector]];
      }});
      Object.defineProperty(ChangeDetector.prototype.removeShadowDomChild, "parameters", {get: function() {
        return [[ChangeDetector]];
      }});
      Object.defineProperty(ChangeDetector.prototype.hydrate, "parameters", {get: function() {
        return [[assert.type.any], [Locals], [assert.type.any]];
      }});
    }
  };
});

System.register("angular2/src/change_detection/pipes/pipe", ["rtts_assert/rtts_assert"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/pipes/pipe";
  var assert,
    NO_CHANGE,
    Pipe;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }],
    execute: function() {
      NO_CHANGE = $__export("NO_CHANGE", new Object());
      Pipe = $__export("Pipe", (function() {
        var Pipe = function Pipe() {
          ;
        };
        return ($traceurRuntime.createClass)(Pipe, {
          supports: function(obj) {
            return assert.returnType((false), assert.type.boolean);
          },
          onDestroy: function() {},
          transform: function(value) {
            assert.argumentTypes(value, assert.type.any);
            return assert.returnType((null), assert.type.any);
          }
        }, {});
      }()));
      Object.defineProperty(Pipe.prototype.transform, "parameters", {get: function() {
        return [[assert.type.any]];
      }});
    }
  };
});

System.register("angular2/src/change_detection/change_detector_ref", ["rtts_assert/rtts_assert", "angular2/src/change_detection/interfaces", "angular2/src/change_detection/constants"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/change_detector_ref";
  var assert,
    ChangeDetector,
    CHECK_ONCE,
    DETACHED,
    CHECK_ALWAYS,
    ChangeDetectorRef;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      ChangeDetector = $__m.ChangeDetector;
    }, function($__m) {
      CHECK_ONCE = $__m.CHECK_ONCE;
      DETACHED = $__m.DETACHED;
      CHECK_ALWAYS = $__m.CHECK_ALWAYS;
    }],
    execute: function() {
      ChangeDetectorRef = $__export("ChangeDetectorRef", (function() {
        var ChangeDetectorRef = function ChangeDetectorRef(cd) {
          assert.argumentTypes(cd, ChangeDetector);
          this._cd = cd;
        };
        return ($traceurRuntime.createClass)(ChangeDetectorRef, {
          requestCheck: function() {
            this._cd.markPathToRootAsCheckOnce();
          },
          detach: function() {
            this._cd.mode = DETACHED;
          },
          reattach: function() {
            this._cd.mode = CHECK_ALWAYS;
            this.requestCheck();
          }
        }, {});
      }()));
      Object.defineProperty(ChangeDetectorRef, "parameters", {get: function() {
        return [[ChangeDetector]];
      }});
    }
  };
});

System.register("angular2/src/change_detection/pipes/pipe_registry", ["rtts_assert/rtts_assert", "angular2/src/facade/collection", "angular2/src/facade/lang", "angular2/src/change_detection/pipes/pipe", "angular2/di", "angular2/src/change_detection/change_detector_ref"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/pipes/pipe_registry";
  var assert,
    List,
    ListWrapper,
    isBlank,
    isPresent,
    BaseException,
    CONST,
    Pipe,
    Injectable,
    ChangeDetectorRef,
    PipeRegistry;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
    }, function($__m) {
      isBlank = $__m.isBlank;
      isPresent = $__m.isPresent;
      BaseException = $__m.BaseException;
      CONST = $__m.CONST;
    }, function($__m) {
      Pipe = $__m.Pipe;
    }, function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      ChangeDetectorRef = $__m.ChangeDetectorRef;
    }],
    execute: function() {
      PipeRegistry = $__export("PipeRegistry", (function() {
        var PipeRegistry = function PipeRegistry(config) {
          this.config = config;
        };
        return ($traceurRuntime.createClass)(PipeRegistry, {get: function(type, obj, cdRef) {
          var listOfConfigs = this.config[type];
          if (isBlank(listOfConfigs)) {
            throw new BaseException(("Cannot find a pipe for type '" + type + "' object '" + obj + "'"));
          }
          var matchingConfig = ListWrapper.find(listOfConfigs, (function(pipeConfig) {
            return pipeConfig.supports(obj);
          }));
          if (isBlank(matchingConfig)) {
            throw new BaseException(("Cannot find a pipe for type '" + type + "' object '" + obj + "'"));
          }
          return assert.returnType((matchingConfig.create(cdRef)), Pipe);
        }}, {});
      }()));
      Object.defineProperty(PipeRegistry, "annotations", {get: function() {
        return [new Injectable()];
      }});
      Object.defineProperty(PipeRegistry.prototype.get, "parameters", {get: function() {
        return [[assert.type.string], [], [ChangeDetectorRef]];
      }});
    }
  };
});

System.register("angular2/src/change_detection/change_detection_jit_generator", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/src/change_detection/abstract_change_detector", "angular2/src/change_detection/change_detection_util", "angular2/src/change_detection/directive_record", "angular2/src/change_detection/proto_record"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/change_detection_jit_generator";
  var assert,
    isPresent,
    isBlank,
    BaseException,
    Type,
    List,
    ListWrapper,
    MapWrapper,
    StringMapWrapper,
    AbstractChangeDetector,
    ChangeDetectionUtil,
    DirectiveRecord,
    ProtoRecord,
    RECORD_TYPE_SELF,
    RECORD_TYPE_PROPERTY,
    RECORD_TYPE_LOCAL,
    RECORD_TYPE_INVOKE_METHOD,
    RECORD_TYPE_CONST,
    RECORD_TYPE_INVOKE_CLOSURE,
    RECORD_TYPE_PRIMITIVE_OP,
    RECORD_TYPE_KEYED_ACCESS,
    RECORD_TYPE_PIPE,
    RECORD_TYPE_BINDING_PIPE,
    RECORD_TYPE_INTERPOLATE,
    ABSTRACT_CHANGE_DETECTOR,
    UTIL,
    DISPATCHER_ACCESSOR,
    PIPE_REGISTRY_ACCESSOR,
    PROTOS_ACCESSOR,
    DIRECTIVES_ACCESSOR,
    CONTEXT_ACCESSOR,
    IS_CHANGED_LOCAL,
    CHANGES_LOCAL,
    LOCALS_ACCESSOR,
    MODE_ACCESSOR,
    TEMP_LOCAL,
    CURRENT_PROTO,
    ChangeDetectorJITGenerator;
  function typeTemplate(type, cons, detectChanges, notifyOnAllChangesDone, setContext) {
    assert.argumentTypes(type, assert.type.string, cons, assert.type.string, detectChanges, assert.type.string, notifyOnAllChangesDone, assert.type.string, setContext, assert.type.string);
    return assert.returnType((("\n" + cons + "\n" + detectChanges + "\n" + notifyOnAllChangesDone + "\n" + setContext + ";\n\nreturn function(dispatcher, pipeRegistry) {\n  return new " + type + "(dispatcher, pipeRegistry, protos, directiveRecords);\n}\n")), assert.type.string);
  }
  function constructorTemplate(type, fieldsDefinitions) {
    assert.argumentTypes(type, assert.type.string, fieldsDefinitions, assert.type.string);
    return assert.returnType((("\nvar " + type + " = function " + type + "(dispatcher, pipeRegistry, protos, directiveRecords) {\n" + ABSTRACT_CHANGE_DETECTOR + ".call(this);\n" + DISPATCHER_ACCESSOR + " = dispatcher;\n" + PIPE_REGISTRY_ACCESSOR + " = pipeRegistry;\n" + PROTOS_ACCESSOR + " = protos;\n" + DIRECTIVES_ACCESSOR + " = directiveRecords;\n" + LOCALS_ACCESSOR + " = null;\n" + fieldsDefinitions + "\n}\n\n" + type + ".prototype = Object.create(" + ABSTRACT_CHANGE_DETECTOR + ".prototype);\n")), assert.type.string);
  }
  function pipeOnDestroyTemplate(pipeNames) {
    return pipeNames.map((function(p) {
      return (p + ".onDestroy()");
    })).join("\n");
  }
  function hydrateTemplate(type, mode, fieldDefinitions, pipeOnDestroy, directiveFieldNames, detectorFieldNames) {
    assert.argumentTypes(type, assert.type.string, mode, assert.type.string, fieldDefinitions, assert.type.string, pipeOnDestroy, assert.type.string, directiveFieldNames, assert.genericType(List, String), detectorFieldNames, assert.genericType(List, String));
    var directiveInit = "";
    for (var i = 0; i < directiveFieldNames.length; ++i) {
      directiveInit += (directiveFieldNames[i] + " = directives.getDirectiveFor(this.directiveRecords[" + i + "]);\n");
    }
    var detectorInit = "";
    for (var i = 0; i < detectorFieldNames.length; ++i) {
      detectorInit += (detectorFieldNames[i] + " = directives.getDetectorFor(this.directiveRecords[" + i + "]);\n");
    }
    return assert.returnType((("\n" + type + ".prototype.hydrate = function(context, locals, directives) {\n  " + MODE_ACCESSOR + " = \"" + mode + "\";\n  " + CONTEXT_ACCESSOR + " = context;\n  " + LOCALS_ACCESSOR + " = locals;\n  " + directiveInit + "\n  " + detectorInit + "\n}\n" + type + ".prototype.dehydrate = function() {\n  " + pipeOnDestroy + "\n  " + fieldDefinitions + "\n  " + LOCALS_ACCESSOR + " = null;\n}\n" + type + ".prototype.hydrated = function() {\n  return " + CONTEXT_ACCESSOR + " !== " + UTIL + ".unitialized();\n}\n")), assert.type.string);
  }
  function detectChangesTemplate(type, body) {
    assert.argumentTypes(type, assert.type.string, body, assert.type.string);
    return assert.returnType((("\n" + type + ".prototype.detectChangesInRecords = function(throwOnChange) {\n  " + body + "\n}\n")), assert.type.string);
  }
  function callOnAllChangesDoneTemplate(type, body) {
    assert.argumentTypes(type, assert.type.string, body, assert.type.string);
    return assert.returnType((("\n" + type + ".prototype.callOnAllChangesDone = function() {\n  " + body + "\n}\n")), assert.type.string);
  }
  function onAllChangesDoneTemplate(directive) {
    assert.argumentTypes(directive, assert.type.string);
    return assert.returnType(((directive + ".onAllChangesDone();")), assert.type.string);
  }
  function detectChangesBodyTemplate(localDefinitions, changeDefinitions, records) {
    assert.argumentTypes(localDefinitions, assert.type.string, changeDefinitions, assert.type.string, records, assert.type.string);
    return assert.returnType((("\n" + localDefinitions + "\n" + changeDefinitions + "\nvar " + TEMP_LOCAL + ";\nvar " + IS_CHANGED_LOCAL + " = false;\nvar " + CURRENT_PROTO + ";\nvar " + CHANGES_LOCAL + " = null;\n\ncontext = " + CONTEXT_ACCESSOR + ";\n" + records + "\n")), assert.type.string);
  }
  function pipeCheckTemplate(protoIndex, context, bindingPropagationConfig, pipe, pipeType, oldValue, newValue, change, update, addToChanges, lastInDirective) {
    assert.argumentTypes(protoIndex, assert.type.number, context, assert.type.string, bindingPropagationConfig, assert.type.string, pipe, assert.type.string, pipeType, assert.type.string, oldValue, assert.type.string, newValue, assert.type.string, change, assert.type.string, update, assert.type.string, addToChanges, assert.type.any, lastInDirective, assert.type.string);
    return assert.returnType((("\n" + CURRENT_PROTO + " = " + PROTOS_ACCESSOR + "[" + protoIndex + "];\nif (" + pipe + " === " + UTIL + ".unitialized()) {\n  " + pipe + " = " + PIPE_REGISTRY_ACCESSOR + ".get('" + pipeType + "', " + context + ", " + bindingPropagationConfig + ");\n} else if (!" + pipe + ".supports(" + context + ")) {\n  " + pipe + ".onDestroy();\n  " + pipe + " = " + PIPE_REGISTRY_ACCESSOR + ".get('" + pipeType + "', " + context + ", " + bindingPropagationConfig + ");\n}\n\n" + newValue + " = " + pipe + ".transform(" + context + ");\nif (! " + UTIL + ".noChangeMarker(" + newValue + ")) {\n  " + change + " = true;\n  " + update + "\n  " + addToChanges + "\n  " + oldValue + " = " + newValue + ";\n}\n" + lastInDirective + "\n")), assert.type.string);
  }
  function referenceCheckTemplate(protoIndex, assignment, oldValue, newValue, change, update, addToChanges, lastInDirective) {
    assert.argumentTypes(protoIndex, assert.type.number, assignment, assert.type.string, oldValue, assert.type.string, newValue, assert.type.string, change, assert.type.string, update, assert.type.string, addToChanges, assert.type.string, lastInDirective, assert.type.string);
    return assert.returnType((("\n" + CURRENT_PROTO + " = " + PROTOS_ACCESSOR + "[" + protoIndex + "];\n" + assignment + "\nif (" + newValue + " !== " + oldValue + " || (" + newValue + " !== " + newValue + ") && (" + oldValue + " !== " + oldValue + ")) {\n  " + change + " = true;\n  " + update + "\n  " + addToChanges + "\n  " + oldValue + " = " + newValue + ";\n}\n" + lastInDirective + "\n")), assert.type.string);
  }
  function assignmentTemplate(field, value) {
    assert.argumentTypes(field, assert.type.string, value, assert.type.string);
    return (field + " = " + value + ";");
  }
  function localDefinitionsTemplate(names) {
    return assert.returnType((names.map((function(n) {
      return ("var " + n + ";");
    })).join("\n")), assert.type.string);
  }
  function changeDefinitionsTemplate(names) {
    return assert.returnType((names.map((function(n) {
      return ("var " + n + " = false;");
    })).join("\n")), assert.type.string);
  }
  function fieldDefinitionsTemplate(names) {
    return assert.returnType((names.map((function(n) {
      return (n + " = " + UTIL + ".unitialized();");
    })).join("\n")), assert.type.string);
  }
  function ifChangedGuardTemplate(changeNames, body) {
    assert.argumentTypes(changeNames, List, body, assert.type.string);
    var cond = changeNames.join(" || ");
    return assert.returnType((("\nif (" + cond + ") {\n  " + body + "\n}\n")), assert.type.string);
  }
  function addToChangesTemplate(oldValue, newValue) {
    assert.argumentTypes(oldValue, assert.type.string, newValue, assert.type.string);
    return assert.returnType(((CHANGES_LOCAL + " = " + UTIL + ".addChange(" + CHANGES_LOCAL + ", " + CURRENT_PROTO + ".bindingRecord.propertyName, " + UTIL + ".simpleChange(" + oldValue + ", " + newValue + "));")), assert.type.string);
  }
  function updateDirectiveTemplate(oldValue, newValue, directiveProperty) {
    assert.argumentTypes(oldValue, assert.type.string, newValue, assert.type.string, directiveProperty, assert.type.string);
    return assert.returnType((("\nif(throwOnChange) " + UTIL + ".throwOnChange(" + CURRENT_PROTO + ", " + UTIL + ".simpleChange(" + oldValue + ", " + newValue + "));\n" + directiveProperty + " = " + newValue + ";\n" + IS_CHANGED_LOCAL + " = true;\n  ")), assert.type.string);
  }
  function updateElementTemplate(oldValue, newValue) {
    assert.argumentTypes(oldValue, assert.type.string, newValue, assert.type.string);
    return assert.returnType((("\nif(throwOnChange) " + UTIL + ".throwOnChange(" + CURRENT_PROTO + ", " + UTIL + ".simpleChange(" + oldValue + ", " + newValue + "));\n" + DISPATCHER_ACCESSOR + ".notifyOnBinding(" + CURRENT_PROTO + ".bindingRecord, " + newValue + ");\n  ")), assert.type.string);
  }
  function notifyOnChangesTemplate(directive) {
    assert.argumentTypes(directive, assert.type.string);
    return assert.returnType((("\nif(" + CHANGES_LOCAL + ") {\n  " + directive + ".onChange(" + CHANGES_LOCAL + ");\n  " + CHANGES_LOCAL + " = null;\n}\n")), assert.type.string);
  }
  function notifyOnPushDetectorsTemplate(detector) {
    assert.argumentTypes(detector, assert.type.string);
    return assert.returnType((("\nif(" + IS_CHANGED_LOCAL + ") {\n  " + detector + ".markAsCheckOnce();\n}\n")), assert.type.string);
  }
  function lastInDirectiveTemplate(notifyOnChanges, notifyOnPush) {
    assert.argumentTypes(notifyOnChanges, assert.type.string, notifyOnPush, assert.type.string);
    return assert.returnType((("\n" + notifyOnChanges + "\n" + notifyOnPush + "\n" + IS_CHANGED_LOCAL + " = false;\n")), assert.type.string);
  }
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isPresent = $__m.isPresent;
      isBlank = $__m.isBlank;
      BaseException = $__m.BaseException;
      Type = $__m.Type;
    }, function($__m) {
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
      MapWrapper = $__m.MapWrapper;
      StringMapWrapper = $__m.StringMapWrapper;
    }, function($__m) {
      AbstractChangeDetector = $__m.AbstractChangeDetector;
    }, function($__m) {
      ChangeDetectionUtil = $__m.ChangeDetectionUtil;
    }, function($__m) {
      DirectiveRecord = $__m.DirectiveRecord;
    }, function($__m) {
      ProtoRecord = $__m.ProtoRecord;
      RECORD_TYPE_SELF = $__m.RECORD_TYPE_SELF;
      RECORD_TYPE_PROPERTY = $__m.RECORD_TYPE_PROPERTY;
      RECORD_TYPE_LOCAL = $__m.RECORD_TYPE_LOCAL;
      RECORD_TYPE_INVOKE_METHOD = $__m.RECORD_TYPE_INVOKE_METHOD;
      RECORD_TYPE_CONST = $__m.RECORD_TYPE_CONST;
      RECORD_TYPE_INVOKE_CLOSURE = $__m.RECORD_TYPE_INVOKE_CLOSURE;
      RECORD_TYPE_PRIMITIVE_OP = $__m.RECORD_TYPE_PRIMITIVE_OP;
      RECORD_TYPE_KEYED_ACCESS = $__m.RECORD_TYPE_KEYED_ACCESS;
      RECORD_TYPE_PIPE = $__m.RECORD_TYPE_PIPE;
      RECORD_TYPE_BINDING_PIPE = $__m.RECORD_TYPE_BINDING_PIPE;
      RECORD_TYPE_INTERPOLATE = $__m.RECORD_TYPE_INTERPOLATE;
    }],
    execute: function() {
      ABSTRACT_CHANGE_DETECTOR = "AbstractChangeDetector";
      UTIL = "ChangeDetectionUtil";
      DISPATCHER_ACCESSOR = "this.dispatcher";
      PIPE_REGISTRY_ACCESSOR = "this.pipeRegistry";
      PROTOS_ACCESSOR = "this.protos";
      DIRECTIVES_ACCESSOR = "this.directiveRecords";
      CONTEXT_ACCESSOR = "this.context";
      IS_CHANGED_LOCAL = "isChanged";
      CHANGES_LOCAL = "changes";
      LOCALS_ACCESSOR = "this.locals";
      MODE_ACCESSOR = "this.mode";
      TEMP_LOCAL = "temp";
      CURRENT_PROTO = "currentProto";
      Object.defineProperty(typeTemplate, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(constructorTemplate, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(pipeOnDestroyTemplate, "parameters", {get: function() {
        return [[List]];
      }});
      Object.defineProperty(hydrateTemplate, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string], [assert.genericType(List, String)], [assert.genericType(List, String)]];
      }});
      Object.defineProperty(detectChangesTemplate, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(callOnAllChangesDoneTemplate, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(onAllChangesDoneTemplate, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(detectChangesBodyTemplate, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(pipeCheckTemplate, "parameters", {get: function() {
        return [[assert.type.number], [assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string], [], [assert.type.string]];
      }});
      Object.defineProperty(referenceCheckTemplate, "parameters", {get: function() {
        return [[assert.type.number], [assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(assignmentTemplate, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(localDefinitionsTemplate, "parameters", {get: function() {
        return [[List]];
      }});
      Object.defineProperty(changeDefinitionsTemplate, "parameters", {get: function() {
        return [[List]];
      }});
      Object.defineProperty(fieldDefinitionsTemplate, "parameters", {get: function() {
        return [[List]];
      }});
      Object.defineProperty(ifChangedGuardTemplate, "parameters", {get: function() {
        return [[List], [assert.type.string]];
      }});
      Object.defineProperty(addToChangesTemplate, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(updateDirectiveTemplate, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(updateElementTemplate, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(notifyOnChangesTemplate, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(notifyOnPushDetectorsTemplate, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(lastInDirectiveTemplate, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      ChangeDetectorJITGenerator = $__export("ChangeDetectorJITGenerator", (function() {
        var ChangeDetectorJITGenerator = function ChangeDetectorJITGenerator(typeName, changeDetectionStrategy, records, directiveRecords) {
          assert.argumentTypes(typeName, assert.type.string, changeDetectionStrategy, assert.type.string, records, assert.genericType(List, ProtoRecord), directiveRecords, List);
          this.typeName = typeName;
          this.changeDetectionStrategy = changeDetectionStrategy;
          this.records = records;
          this.directiveRecords = directiveRecords;
          this.localNames = this.getLocalNames(records);
          this.changeNames = this.getChangeNames(this.localNames);
          this.fieldNames = this.getFieldNames(this.localNames);
          this.pipeNames = this.getPipeNames(this.localNames);
        };
        return ($traceurRuntime.createClass)(ChangeDetectorJITGenerator, {
          getLocalNames: function(records) {
            assert.argumentTypes(records, assert.genericType(List, ProtoRecord));
            var index = 0;
            var names = records.map((function(r) {
              var sanitizedName = r.name.replace(new RegExp("\\W", "g"), '');
              return ("" + sanitizedName + index++);
            }));
            return assert.returnType((["context"].concat(names)), assert.genericType(List, assert.type.string));
          },
          getChangeNames: function(localNames) {
            return assert.returnType((localNames.map((function(n) {
              return ("change_" + n);
            }))), assert.genericType(List, assert.type.string));
          },
          getFieldNames: function(localNames) {
            return assert.returnType((localNames.map((function(n) {
              return ("this." + n);
            }))), assert.genericType(List, assert.type.string));
          },
          getPipeNames: function(localNames) {
            return assert.returnType((localNames.map((function(n) {
              return ("this." + n + "_pipe");
            }))), assert.genericType(List, assert.type.string));
          },
          generate: function() {
            var text = typeTemplate(this.typeName, this.genConstructor(), this.genDetectChanges(), this.genCallOnAllChangesDone(), this.genHydrate());
            return assert.returnType((new Function('AbstractChangeDetector', 'ChangeDetectionUtil', 'protos', 'directiveRecords', text)(AbstractChangeDetector, ChangeDetectionUtil, this.records, this.directiveRecords)), Function);
          },
          genConstructor: function() {
            return assert.returnType((constructorTemplate(this.typeName, this.genFieldDefinitions())), assert.type.string);
          },
          genHydrate: function() {
            var mode = ChangeDetectionUtil.changeDetectionMode(this.changeDetectionStrategy);
            return assert.returnType((hydrateTemplate(this.typeName, mode, this.genFieldDefinitions(), pipeOnDestroyTemplate(this.getNonNullPipeNames()), this.getDirectiveFieldNames(), this.getDetectorFieldNames())), assert.type.string);
          },
          getDirectiveFieldNames: function() {
            var $__0 = this;
            return assert.returnType((this.directiveRecords.map((function(d) {
              return $__0.getDirective(d);
            }))), assert.genericType(List, assert.type.string));
          },
          getDetectorFieldNames: function() {
            var $__0 = this;
            return assert.returnType((this.directiveRecords.filter((function(r) {
              return r.isOnPushChangeDetection();
            })).map((function(d) {
              return $__0.getDetector(d);
            }))), assert.genericType(List, assert.type.string));
          },
          getDirective: function(d) {
            assert.argumentTypes(d, DirectiveRecord);
            return ("this.directive_" + d.name);
          },
          getDetector: function(d) {
            assert.argumentTypes(d, DirectiveRecord);
            return ("this.detector_" + d.name);
          },
          genFieldDefinitions: function() {
            var fields = [];
            fields = fields.concat(this.fieldNames);
            fields = fields.concat(this.getNonNullPipeNames());
            fields = fields.concat(this.getDirectiveFieldNames());
            fields = fields.concat(this.getDetectorFieldNames());
            return fieldDefinitionsTemplate(fields);
          },
          getNonNullPipeNames: function() {
            var $__0 = this;
            var pipes = [];
            this.records.forEach((function(r) {
              if (r.mode === RECORD_TYPE_PIPE || r.mode === RECORD_TYPE_BINDING_PIPE) {
                pipes.push($__0.pipeNames[r.selfIndex]);
              }
            }));
            return assert.returnType((pipes), assert.genericType(List, assert.type.string));
          },
          genDetectChanges: function() {
            var body = this.genDetectChangesBody();
            return assert.returnType((detectChangesTemplate(this.typeName, body)), assert.type.string);
          },
          genCallOnAllChangesDone: function() {
            var notifications = [];
            var dirs = this.directiveRecords;
            for (var i = dirs.length - 1; i >= 0; --i) {
              var dir = dirs[i];
              if (dir.callOnAllChangesDone) {
                var directive = ("this.directive_" + dir.name);
                notifications.push(onAllChangesDoneTemplate(directive));
              }
            }
            return assert.returnType((callOnAllChangesDoneTemplate(this.typeName, notifications.join(";\n"))), assert.type.string);
          },
          genDetectChangesBody: function() {
            var $__0 = this;
            var rec = this.records.map((function(r) {
              return $__0.genRecord(r);
            })).join("\n");
            return assert.returnType((detectChangesBodyTemplate(this.genLocalDefinitions(), this.genChangeDefinitions(), rec)), assert.type.string);
          },
          genLocalDefinitions: function() {
            return assert.returnType((localDefinitionsTemplate(this.localNames)), assert.type.string);
          },
          genChangeDefinitions: function() {
            return assert.returnType((changeDefinitionsTemplate(this.changeNames)), assert.type.string);
          },
          genRecord: function(r) {
            assert.argumentTypes(r, ProtoRecord);
            if (r.mode === RECORD_TYPE_PIPE || r.mode === RECORD_TYPE_BINDING_PIPE) {
              return assert.returnType((this.genPipeCheck(r)), assert.type.string);
            } else {
              return assert.returnType((this.genReferenceCheck(r)), assert.type.string);
            }
          },
          genPipeCheck: function(r) {
            assert.argumentTypes(r, ProtoRecord);
            var context = this.localNames[r.contextIndex];
            var oldValue = this.fieldNames[r.selfIndex];
            var newValue = this.localNames[r.selfIndex];
            var change = this.changeNames[r.selfIndex];
            var pipe = this.pipeNames[r.selfIndex];
            var cdRef = r.mode === RECORD_TYPE_BINDING_PIPE ? "this.ref" : "null";
            var update = this.genUpdateDirectiveOrElement(r);
            var addToChanges = this.genAddToChanges(r);
            var lastInDirective = this.genLastInDirective(r);
            return assert.returnType((pipeCheckTemplate(r.selfIndex - 1, context, cdRef, pipe, r.name, oldValue, newValue, change, update, addToChanges, lastInDirective)), assert.type.string);
          },
          genReferenceCheck: function(r) {
            assert.argumentTypes(r, ProtoRecord);
            var oldValue = this.fieldNames[r.selfIndex];
            var newValue = this.localNames[r.selfIndex];
            var change = this.changeNames[r.selfIndex];
            var assignment = this.genUpdateCurrentValue(r);
            var update = this.genUpdateDirectiveOrElement(r);
            var addToChanges = this.genAddToChanges(r);
            var lastInDirective = this.genLastInDirective(r);
            var check = referenceCheckTemplate(r.selfIndex - 1, assignment, oldValue, newValue, change, update, addToChanges, lastInDirective);
            if (r.isPureFunction()) {
              return assert.returnType((this.ifChangedGuard(r, check)), assert.type.string);
            } else {
              return assert.returnType((check), assert.type.string);
            }
          },
          genUpdateCurrentValue: function(r) {
            assert.argumentTypes(r, ProtoRecord);
            var context = this.localNames[r.contextIndex];
            var newValue = this.localNames[r.selfIndex];
            var args = this.genArgs(r);
            switch (r.mode) {
              case RECORD_TYPE_SELF:
                return assert.returnType((assignmentTemplate(newValue, context)), assert.type.string);
              case RECORD_TYPE_CONST:
                return assert.returnType(((newValue + " = " + this.genLiteral(r.funcOrValue))), assert.type.string);
              case RECORD_TYPE_PROPERTY:
                return assert.returnType((assignmentTemplate(newValue, (context + "." + r.name))), assert.type.string);
              case RECORD_TYPE_LOCAL:
                return assert.returnType((assignmentTemplate(newValue, (LOCALS_ACCESSOR + ".get('" + r.name + "')"))), assert.type.string);
              case RECORD_TYPE_INVOKE_METHOD:
                return assert.returnType((assignmentTemplate(newValue, (context + "." + r.name + "(" + args + ")"))), assert.type.string);
              case RECORD_TYPE_INVOKE_CLOSURE:
                return assert.returnType((assignmentTemplate(newValue, (context + "(" + args + ")"))), assert.type.string);
              case RECORD_TYPE_PRIMITIVE_OP:
                return assert.returnType((assignmentTemplate(newValue, (UTIL + "." + r.name + "(" + args + ")"))), assert.type.string);
              case RECORD_TYPE_INTERPOLATE:
                return assert.returnType((assignmentTemplate(newValue, this.genInterpolation(r))), assert.type.string);
              case RECORD_TYPE_KEYED_ACCESS:
                var key = this.localNames[r.args[0]];
                return assert.returnType((assignmentTemplate(newValue, (context + "[" + key + "]"))), assert.type.string);
              default:
                throw new BaseException(("Unknown operation " + r.mode));
            }
          },
          ifChangedGuard: function(r, body) {
            var $__0 = this;
            return assert.returnType((ifChangedGuardTemplate(r.args.map((function(a) {
              return $__0.changeNames[a];
            })), body)), assert.type.string);
          },
          genInterpolation: function(r) {
            assert.argumentTypes(r, ProtoRecord);
            var res = "";
            for (var i = 0; i < r.args.length; ++i) {
              res += this.genLiteral(r.fixedArgs[i]);
              res += " + ";
              res += this.localNames[r.args[i]];
              res += " + ";
            }
            res += this.genLiteral(r.fixedArgs[r.args.length]);
            return assert.returnType((res), assert.type.string);
          },
          genLiteral: function(value) {
            return assert.returnType((JSON.stringify(value)), assert.type.string);
          },
          genUpdateDirectiveOrElement: function(r) {
            assert.argumentTypes(r, ProtoRecord);
            if (!r.lastInBinding)
              return assert.returnType((""), assert.type.string);
            var newValue = this.localNames[r.selfIndex];
            var oldValue = this.fieldNames[r.selfIndex];
            var br = r.bindingRecord;
            if (br.isDirective()) {
              var directiveProperty = (this.getDirective(br.directiveRecord) + "." + br.propertyName);
              return assert.returnType((updateDirectiveTemplate(oldValue, newValue, directiveProperty)), assert.type.string);
            } else {
              return assert.returnType((updateElementTemplate(oldValue, newValue)), assert.type.string);
            }
          },
          genAddToChanges: function(r) {
            assert.argumentTypes(r, ProtoRecord);
            var newValue = this.localNames[r.selfIndex];
            var oldValue = this.fieldNames[r.selfIndex];
            return assert.returnType((r.bindingRecord.callOnChange() ? addToChangesTemplate(oldValue, newValue) : ""), assert.type.string);
          },
          genLastInDirective: function(r) {
            assert.argumentTypes(r, ProtoRecord);
            var onChanges = this.genNotifyOnChanges(r);
            var onPush = this.genNotifyOnPushDetectors(r);
            return assert.returnType((lastInDirectiveTemplate(onChanges, onPush)), assert.type.string);
          },
          genNotifyOnChanges: function(r) {
            assert.argumentTypes(r, ProtoRecord);
            var br = r.bindingRecord;
            if (r.lastInDirective && br.callOnChange()) {
              return assert.returnType((notifyOnChangesTemplate(this.getDirective(br.directiveRecord))), assert.type.string);
            } else {
              return assert.returnType((""), assert.type.string);
            }
          },
          genNotifyOnPushDetectors: function(r) {
            assert.argumentTypes(r, ProtoRecord);
            var br = r.bindingRecord;
            if (r.lastInDirective && br.isOnPushChangeDetection()) {
              return assert.returnType((notifyOnPushDetectorsTemplate(this.getDetector(br.directiveRecord))), assert.type.string);
            } else {
              return assert.returnType((""), assert.type.string);
            }
          },
          genArgs: function(r) {
            var $__0 = this;
            return assert.returnType((r.args.map((function(arg) {
              return $__0.localNames[arg];
            })).join(", ")), assert.type.string);
          }
        }, {});
      }()));
      Object.defineProperty(ChangeDetectorJITGenerator, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.genericType(List, ProtoRecord)], [List]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.getLocalNames, "parameters", {get: function() {
        return [[assert.genericType(List, ProtoRecord)]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.getChangeNames, "parameters", {get: function() {
        return [[assert.genericType(List, assert.type.string)]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.getFieldNames, "parameters", {get: function() {
        return [[assert.genericType(List, assert.type.string)]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.getPipeNames, "parameters", {get: function() {
        return [[assert.genericType(List, assert.type.string)]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.getDirective, "parameters", {get: function() {
        return [[DirectiveRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.getDetector, "parameters", {get: function() {
        return [[DirectiveRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.genRecord, "parameters", {get: function() {
        return [[ProtoRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.genPipeCheck, "parameters", {get: function() {
        return [[ProtoRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.genReferenceCheck, "parameters", {get: function() {
        return [[ProtoRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.genUpdateCurrentValue, "parameters", {get: function() {
        return [[ProtoRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.ifChangedGuard, "parameters", {get: function() {
        return [[ProtoRecord], [assert.type.string]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.genInterpolation, "parameters", {get: function() {
        return [[ProtoRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.genUpdateDirectiveOrElement, "parameters", {get: function() {
        return [[ProtoRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.genAddToChanges, "parameters", {get: function() {
        return [[ProtoRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.genLastInDirective, "parameters", {get: function() {
        return [[ProtoRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.genNotifyOnChanges, "parameters", {get: function() {
        return [[ProtoRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.genNotifyOnPushDetectors, "parameters", {get: function() {
        return [[ProtoRecord]];
      }});
      Object.defineProperty(ChangeDetectorJITGenerator.prototype.genArgs, "parameters", {get: function() {
        return [[ProtoRecord]];
      }});
    }
  };
});

System.register("angular2/src/change_detection/coalesce", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/src/change_detection/proto_record"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/coalesce";
  var assert,
    isPresent,
    List,
    ListWrapper,
    Map,
    MapWrapper,
    RECORD_TYPE_SELF,
    ProtoRecord;
  function coalesce(records) {
    assert.argumentTypes(records, assert.genericType(List, ProtoRecord));
    var res = ListWrapper.create();
    var indexMap = MapWrapper.create();
    for (var i = 0; i < records.length; ++i) {
      var r = records[i];
      var record = _replaceIndices(r, res.length + 1, indexMap);
      var matchingRecord = _findMatching(record, res);
      if (isPresent(matchingRecord) && record.lastInBinding) {
        ListWrapper.push(res, _selfRecord(record, matchingRecord.selfIndex, res.length + 1));
        MapWrapper.set(indexMap, r.selfIndex, matchingRecord.selfIndex);
      } else if (isPresent(matchingRecord) && !record.lastInBinding) {
        MapWrapper.set(indexMap, r.selfIndex, matchingRecord.selfIndex);
      } else {
        ListWrapper.push(res, record);
        MapWrapper.set(indexMap, r.selfIndex, record.selfIndex);
      }
    }
    return assert.returnType((res), assert.genericType(List, ProtoRecord));
  }
  function _selfRecord(r, contextIndex, selfIndex) {
    assert.argumentTypes(r, ProtoRecord, contextIndex, assert.type.number, selfIndex, assert.type.number);
    return assert.returnType((new ProtoRecord(RECORD_TYPE_SELF, "self", null, [], r.fixedArgs, contextIndex, selfIndex, r.bindingRecord, r.expressionAsString, r.lastInBinding, r.lastInDirective)), ProtoRecord);
  }
  function _findMatching(r, rs) {
    return ListWrapper.find(rs, (function(rr) {
      return rr.mode === r.mode && rr.funcOrValue === r.funcOrValue && rr.contextIndex === r.contextIndex && ListWrapper.equals(rr.args, r.args);
    }));
  }
  function _replaceIndices(r, selfIndex, indexMap) {
    var args = ListWrapper.map(r.args, (function(a) {
      return _map(indexMap, a);
    }));
    var contextIndex = _map(indexMap, r.contextIndex);
    return new ProtoRecord(r.mode, r.name, r.funcOrValue, args, r.fixedArgs, contextIndex, selfIndex, r.bindingRecord, r.expressionAsString, r.lastInBinding, r.lastInDirective);
  }
  function _map(indexMap, value) {
    assert.argumentTypes(indexMap, Map, value, assert.type.number);
    var r = MapWrapper.get(indexMap, value);
    return isPresent(r) ? r : value;
  }
  $__export("coalesce", coalesce);
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isPresent = $__m.isPresent;
    }, function($__m) {
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
      Map = $__m.Map;
      MapWrapper = $__m.MapWrapper;
    }, function($__m) {
      RECORD_TYPE_SELF = $__m.RECORD_TYPE_SELF;
      ProtoRecord = $__m.ProtoRecord;
    }],
    execute: function() {
      Object.defineProperty(coalesce, "parameters", {get: function() {
        return [[assert.genericType(List, ProtoRecord)]];
      }});
      Object.defineProperty(_selfRecord, "parameters", {get: function() {
        return [[ProtoRecord], [assert.type.number], [assert.type.number]];
      }});
      Object.defineProperty(_findMatching, "parameters", {get: function() {
        return [[ProtoRecord], [assert.genericType(List, ProtoRecord)]];
      }});
      Object.defineProperty(_replaceIndices, "parameters", {get: function() {
        return [[ProtoRecord], [assert.type.number], [Map]];
      }});
      Object.defineProperty(_map, "parameters", {get: function() {
        return [[Map], [assert.type.number]];
      }});
    }
  };
});

System.register("angular2/src/change_detection/pipes/iterable_changes", ["rtts_assert/rtts_assert", "angular2/src/facade/collection", "angular2/src/facade/lang", "angular2/src/change_detection/pipes/pipe"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/pipes/iterable_changes";
  var assert,
    isListLikeIterable,
    iterateListLike,
    ListWrapper,
    MapWrapper,
    int,
    isBlank,
    isPresent,
    stringify,
    getMapKey,
    looseIdentical,
    NO_CHANGE,
    Pipe,
    IterableChangesFactory,
    IterableChanges,
    CollectionChangeRecord,
    _DuplicateItemRecordList,
    _DuplicateMap;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isListLikeIterable = $__m.isListLikeIterable;
      iterateListLike = $__m.iterateListLike;
      ListWrapper = $__m.ListWrapper;
      MapWrapper = $__m.MapWrapper;
    }, function($__m) {
      int = $__m.int;
      isBlank = $__m.isBlank;
      isPresent = $__m.isPresent;
      stringify = $__m.stringify;
      getMapKey = $__m.getMapKey;
      looseIdentical = $__m.looseIdentical;
    }, function($__m) {
      NO_CHANGE = $__m.NO_CHANGE;
      Pipe = $__m.Pipe;
    }],
    execute: function() {
      IterableChangesFactory = $__export("IterableChangesFactory", (function() {
        var IterableChangesFactory = function IterableChangesFactory() {
          ;
        };
        return ($traceurRuntime.createClass)(IterableChangesFactory, {
          supports: function(obj) {
            return assert.returnType((IterableChanges.supportsObj(obj)), assert.type.boolean);
          },
          create: function(cdRef) {
            return assert.returnType((new IterableChanges()), Pipe);
          }
        }, {});
      }()));
      IterableChanges = $__export("IterableChanges", (function($__super) {
        var IterableChanges = function IterableChanges() {
          $traceurRuntime.superConstructor(IterableChanges).call(this);
          this._collection = null;
          this._length = null;
          this._linkedRecords = null;
          this._unlinkedRecords = null;
          this._previousItHead = null;
          this._itHead = null;
          this._itTail = null;
          this._additionsHead = null;
          this._additionsTail = null;
          this._movesHead = null;
          this._movesTail = null;
          this._removalsHead = null;
          this._removalsTail = null;
        };
        return ($traceurRuntime.createClass)(IterableChanges, {
          supports: function(obj) {
            return assert.returnType((IterableChanges.supportsObj(obj)), assert.type.boolean);
          },
          get collection() {
            return this._collection;
          },
          get length() {
            return assert.returnType((this._length), int);
          },
          forEachItem: function(fn) {
            assert.argumentTypes(fn, Function);
            var record;
            for (record = this._itHead; record !== null; record = record._next) {
              fn(record);
            }
          },
          forEachPreviousItem: function(fn) {
            assert.argumentTypes(fn, Function);
            var record;
            for (record = this._previousItHead; record !== null; record = record._nextPrevious) {
              fn(record);
            }
          },
          forEachAddedItem: function(fn) {
            assert.argumentTypes(fn, Function);
            var record;
            for (record = this._additionsHead; record !== null; record = record._nextAdded) {
              fn(record);
            }
          },
          forEachMovedItem: function(fn) {
            assert.argumentTypes(fn, Function);
            var record;
            for (record = this._movesHead; record !== null; record = record._nextMoved) {
              fn(record);
            }
          },
          forEachRemovedItem: function(fn) {
            assert.argumentTypes(fn, Function);
            var record;
            for (record = this._removalsHead; record !== null; record = record._nextRemoved) {
              fn(record);
            }
          },
          transform: function(collection) {
            if (this.check(collection)) {
              return this;
            } else {
              return NO_CHANGE;
            }
          },
          check: function(collection) {
            var $__0 = this;
            this._reset();
            var record = assert.type(this._itHead, CollectionChangeRecord);
            var mayBeDirty = assert.type(false, assert.type.boolean);
            var index;
            var item;
            if (ListWrapper.isList(collection)) {
              var list = collection;
              this._length = collection.length;
              for (index = 0; index < this._length; index++) {
                item = list[index];
                if (record === null || !looseIdentical(record.item, item)) {
                  record = this._mismatch(record, item, index);
                  mayBeDirty = true;
                } else if (mayBeDirty) {
                  record = this._verifyReinsertion(record, item, index);
                }
                record = record._next;
              }
            } else {
              index = 0;
              iterateListLike(collection, (function(item) {
                if (record === null || !looseIdentical(record.item, item)) {
                  record = $__0._mismatch(record, item, index);
                  mayBeDirty = true;
                } else if (mayBeDirty) {
                  record = $__0._verifyReinsertion(record, item, index);
                }
                record = record._next;
                index++;
              }));
              this._length = index;
            }
            this._truncate(record);
            this._collection = collection;
            return assert.returnType((this.isDirty), assert.type.boolean);
          },
          get isDirty() {
            return assert.returnType((this._additionsHead !== null || this._movesHead !== null || this._removalsHead !== null), assert.type.boolean);
          },
          _reset: function() {
            if (this.isDirty) {
              var record;
              var nextRecord;
              for (record = this._previousItHead = this._itHead; record !== null; record = record._next) {
                record._nextPrevious = record._next;
              }
              for (record = this._additionsHead; record !== null; record = record._nextAdded) {
                record.previousIndex = record.currentIndex;
              }
              this._additionsHead = this._additionsTail = null;
              for (record = this._movesHead; record !== null; record = nextRecord) {
                record.previousIndex = record.currentIndex;
                nextRecord = record._nextMoved;
              }
              this._movesHead = this._movesTail = null;
              this._removalsHead = this._removalsTail = null;
            }
          },
          _mismatch: function(record, item, index) {
            assert.argumentTypes(record, CollectionChangeRecord, item, assert.type.any, index, int);
            var previousRecord;
            if (record === null) {
              previousRecord = this._itTail;
            } else {
              previousRecord = record._prev;
              this._remove(record);
            }
            record = this._linkedRecords === null ? null : this._linkedRecords.get(item, index);
            if (record !== null) {
              this._moveAfter(record, previousRecord, index);
            } else {
              record = this._unlinkedRecords === null ? null : this._unlinkedRecords.get(item);
              if (record !== null) {
                this._reinsertAfter(record, previousRecord, index);
              } else {
                record = this._addAfter(new CollectionChangeRecord(item), previousRecord, index);
              }
            }
            return assert.returnType((record), CollectionChangeRecord);
          },
          _verifyReinsertion: function(record, item, index) {
            assert.argumentTypes(record, CollectionChangeRecord, item, assert.type.any, index, int);
            var reinsertRecord = assert.type(this._unlinkedRecords === null ? null : this._unlinkedRecords.get(item), CollectionChangeRecord);
            if (reinsertRecord !== null) {
              record = this._reinsertAfter(reinsertRecord, record._prev, index);
            } else if (record.currentIndex != index) {
              record.currentIndex = index;
              this._addToMoves(record, index);
            }
            return assert.returnType((record), CollectionChangeRecord);
          },
          _truncate: function(record) {
            assert.argumentTypes(record, CollectionChangeRecord);
            while (record !== null) {
              var nextRecord = assert.type(record._next, CollectionChangeRecord);
              this._addToRemovals(this._unlink(record));
              record = nextRecord;
            }
            if (this._unlinkedRecords !== null) {
              this._unlinkedRecords.clear();
            }
            if (this._additionsTail !== null) {
              this._additionsTail._nextAdded = null;
            }
            if (this._movesTail !== null) {
              this._movesTail._nextMoved = null;
            }
            if (this._itTail !== null) {
              this._itTail._next = null;
            }
            if (this._removalsTail !== null) {
              this._removalsTail._nextRemoved = null;
            }
          },
          _reinsertAfter: function(record, prevRecord, index) {
            assert.argumentTypes(record, CollectionChangeRecord, prevRecord, CollectionChangeRecord, index, int);
            if (this._unlinkedRecords !== null) {
              this._unlinkedRecords.remove(record);
            }
            var prev = record._prevRemoved;
            var next = record._nextRemoved;
            if (prev === null) {
              this._removalsHead = next;
            } else {
              prev._nextRemoved = next;
            }
            if (next === null) {
              this._removalsTail = prev;
            } else {
              next._prevRemoved = prev;
            }
            this._insertAfter(record, prevRecord, index);
            this._addToMoves(record, index);
            return assert.returnType((record), CollectionChangeRecord);
          },
          _moveAfter: function(record, prevRecord, index) {
            assert.argumentTypes(record, CollectionChangeRecord, prevRecord, CollectionChangeRecord, index, int);
            this._unlink(record);
            this._insertAfter(record, prevRecord, index);
            this._addToMoves(record, index);
            return assert.returnType((record), CollectionChangeRecord);
          },
          _addAfter: function(record, prevRecord, index) {
            assert.argumentTypes(record, CollectionChangeRecord, prevRecord, CollectionChangeRecord, index, int);
            this._insertAfter(record, prevRecord, index);
            if (this._additionsTail === null) {
              this._additionsTail = this._additionsHead = record;
            } else {
              this._additionsTail = this._additionsTail._nextAdded = record;
            }
            return assert.returnType((record), CollectionChangeRecord);
          },
          _insertAfter: function(record, prevRecord, index) {
            assert.argumentTypes(record, CollectionChangeRecord, prevRecord, CollectionChangeRecord, index, int);
            var next = assert.type(prevRecord === null ? this._itHead : prevRecord._next, CollectionChangeRecord);
            record._next = next;
            record._prev = prevRecord;
            if (next === null) {
              this._itTail = record;
            } else {
              next._prev = record;
            }
            if (prevRecord === null) {
              this._itHead = record;
            } else {
              prevRecord._next = record;
            }
            if (this._linkedRecords === null) {
              this._linkedRecords = new _DuplicateMap();
            }
            this._linkedRecords.put(record);
            record.currentIndex = index;
            return assert.returnType((record), CollectionChangeRecord);
          },
          _remove: function(record) {
            assert.argumentTypes(record, CollectionChangeRecord);
            return assert.returnType((this._addToRemovals(this._unlink(record))), CollectionChangeRecord);
          },
          _unlink: function(record) {
            assert.argumentTypes(record, CollectionChangeRecord);
            if (this._linkedRecords !== null) {
              this._linkedRecords.remove(record);
            }
            var prev = record._prev;
            var next = record._next;
            if (prev === null) {
              this._itHead = next;
            } else {
              prev._next = next;
            }
            if (next === null) {
              this._itTail = prev;
            } else {
              next._prev = prev;
            }
            return assert.returnType((record), CollectionChangeRecord);
          },
          _addToMoves: function(record, toIndex) {
            assert.argumentTypes(record, CollectionChangeRecord, toIndex, int);
            if (record.previousIndex === toIndex) {
              return assert.returnType((record), CollectionChangeRecord);
            }
            if (this._movesTail === null) {
              this._movesTail = this._movesHead = record;
            } else {
              this._movesTail = this._movesTail._nextMoved = record;
            }
            return assert.returnType((record), CollectionChangeRecord);
          },
          _addToRemovals: function(record) {
            assert.argumentTypes(record, CollectionChangeRecord);
            if (this._unlinkedRecords === null) {
              this._unlinkedRecords = new _DuplicateMap();
            }
            this._unlinkedRecords.put(record);
            record.currentIndex = null;
            record._nextRemoved = null;
            if (this._removalsTail === null) {
              this._removalsTail = this._removalsHead = record;
              record._prevRemoved = null;
            } else {
              record._prevRemoved = this._removalsTail;
              this._removalsTail = this._removalsTail._nextRemoved = record;
            }
            return assert.returnType((record), CollectionChangeRecord);
          },
          toString: function() {
            var record;
            var list = [];
            for (record = this._itHead; record !== null; record = record._next) {
              ListWrapper.push(list, record);
            }
            var previous = [];
            for (record = this._previousItHead; record !== null; record = record._nextPrevious) {
              ListWrapper.push(previous, record);
            }
            var additions = [];
            for (record = this._additionsHead; record !== null; record = record._nextAdded) {
              ListWrapper.push(additions, record);
            }
            var moves = [];
            for (record = this._movesHead; record !== null; record = record._nextMoved) {
              ListWrapper.push(moves, record);
            }
            var removals = [];
            for (record = this._removalsHead; record !== null; record = record._nextRemoved) {
              ListWrapper.push(removals, record);
            }
            return assert.returnType(("collection: " + list.join(', ') + "\n" + "previous: " + previous.join(', ') + "\n" + "additions: " + additions.join(', ') + "\n" + "moves: " + moves.join(', ') + "\n" + "removals: " + removals.join(', ') + "\n"), assert.type.string);
          }
        }, {supportsObj: function(obj) {
          return assert.returnType((isListLikeIterable(obj)), assert.type.boolean);
        }}, $__super);
      }(Pipe)));
      Object.defineProperty(IterableChanges.prototype.forEachItem, "parameters", {get: function() {
        return [[Function]];
      }});
      Object.defineProperty(IterableChanges.prototype.forEachPreviousItem, "parameters", {get: function() {
        return [[Function]];
      }});
      Object.defineProperty(IterableChanges.prototype.forEachAddedItem, "parameters", {get: function() {
        return [[Function]];
      }});
      Object.defineProperty(IterableChanges.prototype.forEachMovedItem, "parameters", {get: function() {
        return [[Function]];
      }});
      Object.defineProperty(IterableChanges.prototype.forEachRemovedItem, "parameters", {get: function() {
        return [[Function]];
      }});
      Object.defineProperty(IterableChanges.prototype._mismatch, "parameters", {get: function() {
        return [[CollectionChangeRecord], [], [int]];
      }});
      Object.defineProperty(IterableChanges.prototype._verifyReinsertion, "parameters", {get: function() {
        return [[CollectionChangeRecord], [], [int]];
      }});
      Object.defineProperty(IterableChanges.prototype._truncate, "parameters", {get: function() {
        return [[CollectionChangeRecord]];
      }});
      Object.defineProperty(IterableChanges.prototype._reinsertAfter, "parameters", {get: function() {
        return [[CollectionChangeRecord], [CollectionChangeRecord], [int]];
      }});
      Object.defineProperty(IterableChanges.prototype._moveAfter, "parameters", {get: function() {
        return [[CollectionChangeRecord], [CollectionChangeRecord], [int]];
      }});
      Object.defineProperty(IterableChanges.prototype._addAfter, "parameters", {get: function() {
        return [[CollectionChangeRecord], [CollectionChangeRecord], [int]];
      }});
      Object.defineProperty(IterableChanges.prototype._insertAfter, "parameters", {get: function() {
        return [[CollectionChangeRecord], [CollectionChangeRecord], [int]];
      }});
      Object.defineProperty(IterableChanges.prototype._remove, "parameters", {get: function() {
        return [[CollectionChangeRecord]];
      }});
      Object.defineProperty(IterableChanges.prototype._unlink, "parameters", {get: function() {
        return [[CollectionChangeRecord]];
      }});
      Object.defineProperty(IterableChanges.prototype._addToMoves, "parameters", {get: function() {
        return [[CollectionChangeRecord], [int]];
      }});
      Object.defineProperty(IterableChanges.prototype._addToRemovals, "parameters", {get: function() {
        return [[CollectionChangeRecord]];
      }});
      CollectionChangeRecord = $__export("CollectionChangeRecord", (function() {
        var CollectionChangeRecord = function CollectionChangeRecord(item) {
          this.currentIndex = null;
          this.previousIndex = null;
          this.item = item;
          this._nextPrevious = null;
          this._prev = null;
          this._next = null;
          this._prevDup = null;
          this._nextDup = null;
          this._prevRemoved = null;
          this._nextRemoved = null;
          this._nextAdded = null;
          this._nextMoved = null;
        };
        return ($traceurRuntime.createClass)(CollectionChangeRecord, {toString: function() {
          return assert.returnType((this.previousIndex === this.currentIndex ? stringify(this.item) : stringify(this.item) + '[' + stringify(this.previousIndex) + '->' + stringify(this.currentIndex) + ']'), assert.type.string);
        }}, {});
      }()));
      _DuplicateItemRecordList = (function() {
        var _DuplicateItemRecordList = function _DuplicateItemRecordList() {
          this._head = null;
          this._tail = null;
        };
        return ($traceurRuntime.createClass)(_DuplicateItemRecordList, {
          add: function(record) {
            assert.argumentTypes(record, CollectionChangeRecord);
            if (this._head === null) {
              this._head = this._tail = record;
              record._nextDup = null;
              record._prevDup = null;
            } else {
              this._tail._nextDup = record;
              record._prevDup = this._tail;
              record._nextDup = null;
              this._tail = record;
            }
          },
          get: function(item, afterIndex) {
            assert.argumentTypes(item, assert.type.any, afterIndex, int);
            var record;
            for (record = this._head; record !== null; record = record._nextDup) {
              if ((afterIndex === null || afterIndex < record.currentIndex) && looseIdentical(record.item, item)) {
                return assert.returnType((record), CollectionChangeRecord);
              }
            }
            return assert.returnType((null), CollectionChangeRecord);
          },
          remove: function(record) {
            assert.argumentTypes(record, CollectionChangeRecord);
            var prev = assert.type(record._prevDup, CollectionChangeRecord);
            var next = assert.type(record._nextDup, CollectionChangeRecord);
            if (prev === null) {
              this._head = next;
            } else {
              prev._nextDup = next;
            }
            if (next === null) {
              this._tail = prev;
            } else {
              next._prevDup = prev;
            }
            return assert.returnType((this._head === null), assert.type.boolean);
          }
        }, {});
      }());
      Object.defineProperty(_DuplicateItemRecordList.prototype.add, "parameters", {get: function() {
        return [[CollectionChangeRecord]];
      }});
      Object.defineProperty(_DuplicateItemRecordList.prototype.get, "parameters", {get: function() {
        return [[], [int]];
      }});
      Object.defineProperty(_DuplicateItemRecordList.prototype.remove, "parameters", {get: function() {
        return [[CollectionChangeRecord]];
      }});
      _DuplicateMap = (function() {
        var _DuplicateMap = function _DuplicateMap() {
          this.map = MapWrapper.create();
        };
        return ($traceurRuntime.createClass)(_DuplicateMap, {
          put: function(record) {
            assert.argumentTypes(record, CollectionChangeRecord);
            var key = getMapKey(record.item);
            var duplicates = MapWrapper.get(this.map, key);
            if (!isPresent(duplicates)) {
              duplicates = new _DuplicateItemRecordList();
              MapWrapper.set(this.map, key, duplicates);
            }
            duplicates.add(record);
          },
          get: function(value) {
            var afterIndex = arguments[1] !== (void 0) ? arguments[1] : null;
            var key = getMapKey(value);
            var recordList = MapWrapper.get(this.map, key);
            return assert.returnType((isBlank(recordList) ? null : recordList.get(value, afterIndex)), CollectionChangeRecord);
          },
          remove: function(record) {
            assert.argumentTypes(record, CollectionChangeRecord);
            var key = getMapKey(record.item);
            var recordList = assert.type(MapWrapper.get(this.map, key), _DuplicateItemRecordList);
            if (recordList.remove(record)) {
              MapWrapper.delete(this.map, key);
            }
            return assert.returnType((record), CollectionChangeRecord);
          },
          get isEmpty() {
            return assert.returnType((MapWrapper.size(this.map) === 0), assert.type.boolean);
          },
          clear: function() {
            MapWrapper.clear(this.map);
          },
          toString: function() {
            return assert.returnType(('_DuplicateMap(' + stringify(this.map) + ')'), assert.type.string);
          }
        }, {});
      }());
      Object.defineProperty(_DuplicateMap.prototype.put, "parameters", {get: function() {
        return [[CollectionChangeRecord]];
      }});
      Object.defineProperty(_DuplicateMap.prototype.remove, "parameters", {get: function() {
        return [[CollectionChangeRecord]];
      }});
    }
  };
});

System.register("angular2/src/change_detection/pipes/keyvalue_changes", ["rtts_assert/rtts_assert", "angular2/src/facade/collection", "angular2/src/facade/lang", "angular2/src/change_detection/pipes/pipe"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/pipes/keyvalue_changes";
  var assert,
    ListWrapper,
    MapWrapper,
    StringMapWrapper,
    stringify,
    looseIdentical,
    isJsObject,
    NO_CHANGE,
    Pipe,
    KeyValueChangesFactory,
    KeyValueChanges,
    KVChangeRecord;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      ListWrapper = $__m.ListWrapper;
      MapWrapper = $__m.MapWrapper;
      StringMapWrapper = $__m.StringMapWrapper;
    }, function($__m) {
      stringify = $__m.stringify;
      looseIdentical = $__m.looseIdentical;
      isJsObject = $__m.isJsObject;
    }, function($__m) {
      NO_CHANGE = $__m.NO_CHANGE;
      Pipe = $__m.Pipe;
    }],
    execute: function() {
      KeyValueChangesFactory = $__export("KeyValueChangesFactory", (function() {
        var KeyValueChangesFactory = function KeyValueChangesFactory() {
          ;
        };
        return ($traceurRuntime.createClass)(KeyValueChangesFactory, {
          supports: function(obj) {
            return assert.returnType((KeyValueChanges.supportsObj(obj)), assert.type.boolean);
          },
          create: function(cdRef) {
            return assert.returnType((new KeyValueChanges()), Pipe);
          }
        }, {});
      }()));
      KeyValueChanges = $__export("KeyValueChanges", (function($__super) {
        var KeyValueChanges = function KeyValueChanges() {
          $traceurRuntime.superConstructor(KeyValueChanges).call(this);
          this._records = MapWrapper.create();
          this._mapHead = null;
          this._previousMapHead = null;
          this._changesHead = null;
          this._changesTail = null;
          this._additionsHead = null;
          this._additionsTail = null;
          this._removalsHead = null;
          this._removalsTail = null;
        };
        return ($traceurRuntime.createClass)(KeyValueChanges, {
          supports: function(obj) {
            return assert.returnType((KeyValueChanges.supportsObj(obj)), assert.type.boolean);
          },
          transform: function(map) {
            if (this.check(map)) {
              return this;
            } else {
              return NO_CHANGE;
            }
          },
          get isDirty() {
            return assert.returnType((this._additionsHead !== null || this._changesHead !== null || this._removalsHead !== null), assert.type.boolean);
          },
          forEachItem: function(fn) {
            assert.argumentTypes(fn, Function);
            var record;
            for (record = this._mapHead; record !== null; record = record._next) {
              fn(record);
            }
          },
          forEachPreviousItem: function(fn) {
            assert.argumentTypes(fn, Function);
            var record;
            for (record = this._previousMapHead; record !== null; record = record._nextPrevious) {
              fn(record);
            }
          },
          forEachChangedItem: function(fn) {
            assert.argumentTypes(fn, Function);
            var record;
            for (record = this._changesHead; record !== null; record = record._nextChanged) {
              fn(record);
            }
          },
          forEachAddedItem: function(fn) {
            assert.argumentTypes(fn, Function);
            var record;
            for (record = this._additionsHead; record !== null; record = record._nextAdded) {
              fn(record);
            }
          },
          forEachRemovedItem: function(fn) {
            assert.argumentTypes(fn, Function);
            var record;
            for (record = this._removalsHead; record !== null; record = record._nextRemoved) {
              fn(record);
            }
          },
          check: function(map) {
            var $__0 = this;
            this._reset();
            var records = this._records;
            var oldSeqRecord = assert.type(this._mapHead, KVChangeRecord);
            var lastOldSeqRecord = assert.type(null, KVChangeRecord);
            var lastNewSeqRecord = assert.type(null, KVChangeRecord);
            var seqChanged = assert.type(false, assert.type.boolean);
            this._forEach(map, (function(value, key) {
              var newSeqRecord;
              if (oldSeqRecord !== null && key === oldSeqRecord.key) {
                newSeqRecord = oldSeqRecord;
                if (!looseIdentical(value, oldSeqRecord.currentValue)) {
                  oldSeqRecord.previousValue = oldSeqRecord.currentValue;
                  oldSeqRecord.currentValue = value;
                  $__0._addToChanges(oldSeqRecord);
                }
              } else {
                seqChanged = true;
                if (oldSeqRecord !== null) {
                  oldSeqRecord._next = null;
                  $__0._removeFromSeq(lastOldSeqRecord, oldSeqRecord);
                  $__0._addToRemovals(oldSeqRecord);
                }
                if (MapWrapper.contains(records, key)) {
                  newSeqRecord = MapWrapper.get(records, key);
                } else {
                  newSeqRecord = new KVChangeRecord(key);
                  MapWrapper.set(records, key, newSeqRecord);
                  newSeqRecord.currentValue = value;
                  $__0._addToAdditions(newSeqRecord);
                }
              }
              if (seqChanged) {
                if ($__0._isInRemovals(newSeqRecord)) {
                  $__0._removeFromRemovals(newSeqRecord);
                }
                if (lastNewSeqRecord == null) {
                  $__0._mapHead = newSeqRecord;
                } else {
                  lastNewSeqRecord._next = newSeqRecord;
                }
              }
              lastOldSeqRecord = oldSeqRecord;
              lastNewSeqRecord = newSeqRecord;
              oldSeqRecord = oldSeqRecord === null ? null : oldSeqRecord._next;
            }));
            this._truncate(lastOldSeqRecord, oldSeqRecord);
            return assert.returnType((this.isDirty), assert.type.boolean);
          },
          _reset: function() {
            if (this.isDirty) {
              var record;
              for (record = this._previousMapHead = this._mapHead; record !== null; record = record._next) {
                record._nextPrevious = record._next;
              }
              for (record = this._changesHead; record !== null; record = record._nextChanged) {
                record.previousValue = record.currentValue;
              }
              for (record = this._additionsHead; record != null; record = record._nextAdded) {
                record.previousValue = record.currentValue;
              }
              this._changesHead = this._changesTail = null;
              this._additionsHead = this._additionsTail = null;
              this._removalsHead = this._removalsTail = null;
            }
          },
          _truncate: function(lastRecord, record) {
            assert.argumentTypes(lastRecord, KVChangeRecord, record, KVChangeRecord);
            while (record !== null) {
              if (lastRecord === null) {
                this._mapHead = null;
              } else {
                lastRecord._next = null;
              }
              var nextRecord = record._next;
              this._addToRemovals(record);
              lastRecord = record;
              record = nextRecord;
            }
            for (var rec = assert.type(this._removalsHead, KVChangeRecord); rec !== null; rec = rec._nextRemoved) {
              rec.previousValue = rec.currentValue;
              rec.currentValue = null;
              MapWrapper.delete(this._records, rec.key);
            }
          },
          _isInRemovals: function(record) {
            assert.argumentTypes(record, KVChangeRecord);
            return record === this._removalsHead || record._nextRemoved !== null || record._prevRemoved !== null;
          },
          _addToRemovals: function(record) {
            assert.argumentTypes(record, KVChangeRecord);
            if (this._removalsHead === null) {
              this._removalsHead = this._removalsTail = record;
            } else {
              this._removalsTail._nextRemoved = record;
              record._prevRemoved = this._removalsTail;
              this._removalsTail = record;
            }
          },
          _removeFromSeq: function(prev, record) {
            assert.argumentTypes(prev, KVChangeRecord, record, KVChangeRecord);
            var next = record._next;
            if (prev === null) {
              this._mapHead = next;
            } else {
              prev._next = next;
            }
          },
          _removeFromRemovals: function(record) {
            assert.argumentTypes(record, KVChangeRecord);
            var prev = record._prevRemoved;
            var next = record._nextRemoved;
            if (prev === null) {
              this._removalsHead = next;
            } else {
              prev._nextRemoved = next;
            }
            if (next === null) {
              this._removalsTail = prev;
            } else {
              next._prevRemoved = prev;
            }
            record._prevRemoved = record._nextRemoved = null;
          },
          _addToAdditions: function(record) {
            assert.argumentTypes(record, KVChangeRecord);
            if (this._additionsHead === null) {
              this._additionsHead = this._additionsTail = record;
            } else {
              this._additionsTail._nextAdded = record;
              this._additionsTail = record;
            }
          },
          _addToChanges: function(record) {
            assert.argumentTypes(record, KVChangeRecord);
            if (this._changesHead === null) {
              this._changesHead = this._changesTail = record;
            } else {
              this._changesTail._nextChanged = record;
              this._changesTail = record;
            }
          },
          toString: function() {
            var items = [];
            var previous = [];
            var changes = [];
            var additions = [];
            var removals = [];
            var record;
            for (record = this._mapHead; record !== null; record = record._next) {
              ListWrapper.push(items, stringify(record));
            }
            for (record = this._previousMapHead; record !== null; record = record._nextPrevious) {
              ListWrapper.push(previous, stringify(record));
            }
            for (record = this._changesHead; record !== null; record = record._nextChanged) {
              ListWrapper.push(changes, stringify(record));
            }
            for (record = this._additionsHead; record !== null; record = record._nextAdded) {
              ListWrapper.push(additions, stringify(record));
            }
            for (record = this._removalsHead; record !== null; record = record._nextRemoved) {
              ListWrapper.push(removals, stringify(record));
            }
            return assert.returnType(("map: " + items.join(', ') + "\n" + "previous: " + previous.join(', ') + "\n" + "additions: " + additions.join(', ') + "\n" + "changes: " + changes.join(', ') + "\n" + "removals: " + removals.join(', ') + "\n"), assert.type.string);
          },
          _forEach: function(obj, fn) {
            assert.argumentTypes(obj, assert.type.any, fn, Function);
            if (obj instanceof Map) {
              MapWrapper.forEach(obj, fn);
            } else {
              StringMapWrapper.forEach(obj, fn);
            }
          }
        }, {supportsObj: function(obj) {
          return assert.returnType((obj instanceof Map || isJsObject(obj)), assert.type.boolean);
        }}, $__super);
      }(Pipe)));
      Object.defineProperty(KeyValueChanges.prototype.forEachItem, "parameters", {get: function() {
        return [[Function]];
      }});
      Object.defineProperty(KeyValueChanges.prototype.forEachPreviousItem, "parameters", {get: function() {
        return [[Function]];
      }});
      Object.defineProperty(KeyValueChanges.prototype.forEachChangedItem, "parameters", {get: function() {
        return [[Function]];
      }});
      Object.defineProperty(KeyValueChanges.prototype.forEachAddedItem, "parameters", {get: function() {
        return [[Function]];
      }});
      Object.defineProperty(KeyValueChanges.prototype.forEachRemovedItem, "parameters", {get: function() {
        return [[Function]];
      }});
      Object.defineProperty(KeyValueChanges.prototype._truncate, "parameters", {get: function() {
        return [[KVChangeRecord], [KVChangeRecord]];
      }});
      Object.defineProperty(KeyValueChanges.prototype._isInRemovals, "parameters", {get: function() {
        return [[KVChangeRecord]];
      }});
      Object.defineProperty(KeyValueChanges.prototype._addToRemovals, "parameters", {get: function() {
        return [[KVChangeRecord]];
      }});
      Object.defineProperty(KeyValueChanges.prototype._removeFromSeq, "parameters", {get: function() {
        return [[KVChangeRecord], [KVChangeRecord]];
      }});
      Object.defineProperty(KeyValueChanges.prototype._removeFromRemovals, "parameters", {get: function() {
        return [[KVChangeRecord]];
      }});
      Object.defineProperty(KeyValueChanges.prototype._addToAdditions, "parameters", {get: function() {
        return [[KVChangeRecord]];
      }});
      Object.defineProperty(KeyValueChanges.prototype._addToChanges, "parameters", {get: function() {
        return [[KVChangeRecord]];
      }});
      Object.defineProperty(KeyValueChanges.prototype._forEach, "parameters", {get: function() {
        return [[], [Function]];
      }});
      KVChangeRecord = $__export("KVChangeRecord", (function() {
        var KVChangeRecord = function KVChangeRecord(key) {
          this.key = key;
          this.previousValue = null;
          this.currentValue = null;
          this._nextPrevious = null;
          this._next = null;
          this._nextAdded = null;
          this._nextRemoved = null;
          this._prevRemoved = null;
          this._nextChanged = null;
        };
        return ($traceurRuntime.createClass)(KVChangeRecord, {toString: function() {
          return assert.returnType((looseIdentical(this.previousValue, this.currentValue) ? stringify(this.key) : (stringify(this.key) + '[' + stringify(this.previousValue) + '->' + stringify(this.currentValue) + ']')), assert.type.string);
        }}, {});
      }()));
    }
  };
});

System.register("angular2/src/change_detection/pipes/async_pipe", ["rtts_assert/rtts_assert", "angular2/src/facade/async", "angular2/src/facade/lang", "angular2/src/change_detection/pipes/pipe", "angular2/src/change_detection/change_detector_ref"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/pipes/async_pipe";
  var assert,
    Observable,
    ObservableWrapper,
    isBlank,
    isPresent,
    Pipe,
    NO_CHANGE,
    ChangeDetectorRef,
    AsyncPipe,
    AsyncPipeFactory;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Observable = $__m.Observable;
      ObservableWrapper = $__m.ObservableWrapper;
    }, function($__m) {
      isBlank = $__m.isBlank;
      isPresent = $__m.isPresent;
    }, function($__m) {
      Pipe = $__m.Pipe;
      NO_CHANGE = $__m.NO_CHANGE;
    }, function($__m) {
      ChangeDetectorRef = $__m.ChangeDetectorRef;
    }],
    execute: function() {
      AsyncPipe = $__export("AsyncPipe", (function($__super) {
        var AsyncPipe = function AsyncPipe(ref) {
          assert.argumentTypes(ref, ChangeDetectorRef);
          $traceurRuntime.superConstructor(AsyncPipe).call(this);
          this._ref = ref;
          this._latestValue = null;
          this._latestReturnedValue = null;
          this._subscription = null;
          this._observable = null;
        };
        return ($traceurRuntime.createClass)(AsyncPipe, {
          supports: function(obs) {
            return assert.returnType((ObservableWrapper.isObservable(obs)), assert.type.boolean);
          },
          onDestroy: function() {
            if (isPresent(this._subscription)) {
              this._dispose();
            }
            ;
          },
          transform: function(obs) {
            assert.argumentTypes(obs, Observable);
            if (isBlank(this._subscription)) {
              this._subscribe(obs);
              return assert.returnType((null), assert.type.any);
            }
            if (obs !== this._observable) {
              this._dispose();
              return assert.returnType((this.transform(obs)), assert.type.any);
            }
            if (this._latestValue === this._latestReturnedValue) {
              return assert.returnType((NO_CHANGE), assert.type.any);
            } else {
              this._latestReturnedValue = this._latestValue;
              return assert.returnType((this._latestValue), assert.type.any);
            }
          },
          _subscribe: function(obs) {
            var $__0 = this;
            this._observable = obs;
            this._subscription = ObservableWrapper.subscribe(obs, (function(value) {
              return $__0._updateLatestValue(value);
            }), (function(e) {
              throw e;
            }));
          },
          _dispose: function() {
            ObservableWrapper.dispose(this._subscription);
            this._latestValue = null;
            this._latestReturnedValue = null;
            this._subscription = null;
            this._observable = null;
          },
          _updateLatestValue: function(value) {
            assert.argumentTypes(value, Object);
            this._latestValue = value;
            this._ref.requestCheck();
          }
        }, {}, $__super);
      }(Pipe)));
      Object.defineProperty(AsyncPipe, "parameters", {get: function() {
        return [[ChangeDetectorRef]];
      }});
      Object.defineProperty(AsyncPipe.prototype.transform, "parameters", {get: function() {
        return [[Observable]];
      }});
      Object.defineProperty(AsyncPipe.prototype._subscribe, "parameters", {get: function() {
        return [[Observable]];
      }});
      Object.defineProperty(AsyncPipe.prototype._updateLatestValue, "parameters", {get: function() {
        return [[Object]];
      }});
      AsyncPipeFactory = $__export("AsyncPipeFactory", (function() {
        var AsyncPipeFactory = function AsyncPipeFactory() {
          ;
        };
        return ($traceurRuntime.createClass)(AsyncPipeFactory, {
          supports: function(obs) {
            return assert.returnType((ObservableWrapper.isObservable(obs)), assert.type.boolean);
          },
          create: function(cdRef) {
            return assert.returnType((new AsyncPipe(cdRef)), Pipe);
          }
        }, {});
      }()));
    }
  };
});

System.register("angular2/src/change_detection/pipes/null_pipe", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/change_detection/pipes/pipe"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/change_detection/pipes/null_pipe";
  var assert,
    isBlank,
    Pipe,
    NO_CHANGE,
    NullPipeFactory,
    NullPipe;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isBlank = $__m.isBlank;
    }, function($__m) {
      Pipe = $__m.Pipe;
      NO_CHANGE = $__m.NO_CHANGE;
    }],
    execute: function() {
      NullPipeFactory = $__export("NullPipeFactory", (function() {
        var NullPipeFactory = function NullPipeFactory() {
          ;
        };
        return ($traceurRuntime.createClass)(NullPipeFactory, {
          supports: function(obj) {
            return assert.returnType((NullPipe.supportsObj(obj)), assert.type.boolean);
          },
          create: function(cdRef) {
            return assert.returnType((new NullPipe()), Pipe);
          }
        }, {});
      }()));
      NullPipe = $__export("NullPipe", (function($__super) {
        var NullPipe = function NullPipe() {
          $traceurRuntime.superConstructor(NullPipe).call(this);
          this.called = false;
        };
        return ($traceurRuntime.createClass)(NullPipe, {
          supports: function(obj) {
            return NullPipe.supportsObj(obj);
          },
          transform: function(value) {
            if (!this.called) {
              this.called = true;
              return null;
            } else {
              return NO_CHANGE;
            }
          }
        }, {supportsObj: function(obj) {
          return assert.returnType((isBlank(obj)), assert.type.boolean);
        }}, $__super);
      }(Pipe)));
    }
  };
});

System.register("angular2/src/core/annotations/visibility", ["angular2/src/facade/lang", "angular2/di"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/annotations/visibility";
  var CONST,
    DependencyAnnotation,
    Parent,
    Ancestor;
  return {
    setters: [function($__m) {
      CONST = $__m.CONST;
    }, function($__m) {
      DependencyAnnotation = $__m.DependencyAnnotation;
    }],
    execute: function() {
      Parent = $__export("Parent", (function($__super) {
        var Parent = function Parent() {
          $traceurRuntime.superConstructor(Parent).call(this);
        };
        return ($traceurRuntime.createClass)(Parent, {}, {}, $__super);
      }(DependencyAnnotation)));
      Object.defineProperty(Parent, "annotations", {get: function() {
        return [new CONST()];
      }});
      Ancestor = $__export("Ancestor", (function($__super) {
        var Ancestor = function Ancestor() {
          $traceurRuntime.superConstructor(Ancestor).call(this);
        };
        return ($traceurRuntime.createClass)(Ancestor, {}, {}, $__super);
      }(DependencyAnnotation)));
      Object.defineProperty(Ancestor, "annotations", {get: function() {
        return [new CONST()];
      }});
    }
  };
});

System.register("angular2/src/core/compiler/interfaces", [], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/compiler/interfaces";
  var OnChange;
  return {
    setters: [],
    execute: function() {
      OnChange = $__export("OnChange", (function() {
        var OnChange = function OnChange() {
          ;
        };
        return ($traceurRuntime.createClass)(OnChange, {onChange: function(changes) {
          throw "OnChange.onChange is not implemented";
        }}, {});
      }()));
    }
  };
});

System.register("angular2/src/core/annotations/view", ["angular2/src/facade/lang"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/annotations/view";
  var ABSTRACT,
    CONST,
    Type,
    ViewAnnotation;
  return {
    setters: [function($__m) {
      ABSTRACT = $__m.ABSTRACT;
      CONST = $__m.CONST;
      Type = $__m.Type;
    }],
    execute: function() {
      ViewAnnotation = $__export("ViewAnnotation", (function() {
        var ViewAnnotation = function ViewAnnotation($__1) {
          var $__2 = $__1,
            templateUrl = $__2.templateUrl,
            template = $__2.template,
            directives = $__2.directives;
          this.templateUrl = templateUrl;
          this.template = template;
          this.directives = directives;
        };
        return ($traceurRuntime.createClass)(ViewAnnotation, {}, {});
      }()));
      Object.defineProperty(ViewAnnotation, "annotations", {get: function() {
        return [new CONST()];
      }});
    }
  };
});

System.register("angular2/src/core/annotations/annotations", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/di", "angular2/change_detection"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/annotations/annotations";
  var assert,
    ABSTRACT,
    CONST,
    normalizeBlank,
    isPresent,
    ListWrapper,
    List,
    Injectable,
    DEFAULT,
    DirectiveAnnotation,
    ComponentAnnotation,
    DynamicComponentAnnotation,
    DecoratorAnnotation,
    ViewportAnnotation,
    onDestroy,
    onChange,
    onAllChangesDone;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      ABSTRACT = $__m.ABSTRACT;
      CONST = $__m.CONST;
      normalizeBlank = $__m.normalizeBlank;
      isPresent = $__m.isPresent;
    }, function($__m) {
      ListWrapper = $__m.ListWrapper;
      List = $__m.List;
    }, function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      DEFAULT = $__m.DEFAULT;
    }],
    execute: function() {
      DirectiveAnnotation = $__export("DirectiveAnnotation", (function($__super) {
        var DirectiveAnnotation = function DirectiveAnnotation() {
          var $__1 = arguments[0] !== (void 0) ? arguments[0] : {},
            selector = $__1.selector,
            properties = $__1.properties,
            events = $__1.events,
            hostListeners = $__1.hostListeners,
            lifecycle = $__1.lifecycle;
          $traceurRuntime.superConstructor(DirectiveAnnotation).call(this);
          this.selector = selector;
          this.properties = properties;
          this.events = events;
          this.hostListeners = hostListeners;
          this.lifecycle = lifecycle;
        };
        return ($traceurRuntime.createClass)(DirectiveAnnotation, {hasLifecycleHook: function(hook) {
          assert.argumentTypes(hook, assert.type.string);
          return assert.returnType((isPresent(this.lifecycle) ? ListWrapper.contains(this.lifecycle, hook) : false), assert.type.boolean);
        }}, {}, $__super);
      }(Injectable)));
      Object.defineProperty(DirectiveAnnotation, "annotations", {get: function() {
        return [new ABSTRACT(), new CONST()];
      }});
      Object.defineProperty(DirectiveAnnotation.prototype.hasLifecycleHook, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      ComponentAnnotation = $__export("ComponentAnnotation", (function($__super) {
        var ComponentAnnotation = function ComponentAnnotation() {
          var $__2;
          var $__1 = arguments[0] !== (void 0) ? arguments[0] : {},
            selector = $__1.selector,
            properties = $__1.properties,
            events = $__1.events,
            hostListeners = $__1.hostListeners,
            injectables = $__1.injectables,
            lifecycle = $__1.lifecycle,
            changeDetection = ($__2 = $__1.changeDetection) === void 0 ? DEFAULT : $__2;
          $traceurRuntime.superConstructor(ComponentAnnotation).call(this, {
            selector: selector,
            properties: properties,
            events: events,
            hostListeners: hostListeners,
            lifecycle: lifecycle
          });
          this.changeDetection = changeDetection;
          this.injectables = injectables;
        };
        return ($traceurRuntime.createClass)(ComponentAnnotation, {}, {}, $__super);
      }(DirectiveAnnotation)));
      Object.defineProperty(ComponentAnnotation, "annotations", {get: function() {
        return [new CONST()];
      }});
      DynamicComponentAnnotation = $__export("DynamicComponentAnnotation", (function($__super) {
        var DynamicComponentAnnotation = function DynamicComponentAnnotation() {
          var $__1 = arguments[0] !== (void 0) ? arguments[0] : {},
            selector = $__1.selector,
            properties = $__1.properties,
            events = $__1.events,
            hostListeners = $__1.hostListeners,
            injectables = $__1.injectables,
            lifecycle = $__1.lifecycle;
          $traceurRuntime.superConstructor(DynamicComponentAnnotation).call(this, {
            selector: selector,
            properties: properties,
            events: events,
            hostListeners: hostListeners,
            lifecycle: lifecycle
          });
          this.injectables = injectables;
        };
        return ($traceurRuntime.createClass)(DynamicComponentAnnotation, {}, {}, $__super);
      }(DirectiveAnnotation)));
      Object.defineProperty(DynamicComponentAnnotation, "annotations", {get: function() {
        return [new CONST()];
      }});
      DecoratorAnnotation = $__export("DecoratorAnnotation", (function($__super) {
        var DecoratorAnnotation = function DecoratorAnnotation() {
          var $__2;
          var $__1 = arguments[0] !== (void 0) ? arguments[0] : {},
            selector = $__1.selector,
            properties = $__1.properties,
            events = $__1.events,
            hostListeners = $__1.hostListeners,
            lifecycle = $__1.lifecycle,
            compileChildren = ($__2 = $__1.compileChildren) === void 0 ? true : $__2;
          $traceurRuntime.superConstructor(DecoratorAnnotation).call(this, {
            selector: selector,
            properties: properties,
            events: events,
            hostListeners: hostListeners,
            lifecycle: lifecycle
          });
          this.compileChildren = compileChildren;
        };
        return ($traceurRuntime.createClass)(DecoratorAnnotation, {}, {}, $__super);
      }(DirectiveAnnotation)));
      Object.defineProperty(DecoratorAnnotation, "annotations", {get: function() {
        return [new CONST()];
      }});
      ViewportAnnotation = $__export("ViewportAnnotation", (function($__super) {
        var ViewportAnnotation = function ViewportAnnotation() {
          var $__1 = arguments[0] !== (void 0) ? arguments[0] : {},
            selector = $__1.selector,
            properties = $__1.properties,
            events = $__1.events,
            hostListeners = $__1.hostListeners,
            lifecycle = $__1.lifecycle;
          $traceurRuntime.superConstructor(ViewportAnnotation).call(this, {
            selector: selector,
            properties: properties,
            events: events,
            hostListeners: hostListeners,
            lifecycle: lifecycle
          });
        };
        return ($traceurRuntime.createClass)(ViewportAnnotation, {}, {}, $__super);
      }(DirectiveAnnotation)));
      Object.defineProperty(ViewportAnnotation, "annotations", {get: function() {
        return [new CONST()];
      }});
      onDestroy = $__export("onDestroy", "onDestroy");
      onChange = $__export("onChange", "onChange");
      onAllChangesDone = $__export("onAllChangesDone", "onAllChangesDone");
    }
  };
});

System.register("angular2/src/dom/dom_adapter", ["rtts_assert/rtts_assert", "angular2/src/facade/lang"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/dom/dom_adapter";
  var assert,
    ABSTRACT,
    BaseException,
    DOM,
    DomAdapter;
  function setRootDomAdapter(adapter) {
    assert.argumentTypes(adapter, DomAdapter);
    $__export("DOM", DOM = adapter);
  }
  function _abstract() {
    return new BaseException('This method is abstract');
  }
  $__export("setRootDomAdapter", setRootDomAdapter);
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      ABSTRACT = $__m.ABSTRACT;
      BaseException = $__m.BaseException;
    }],
    execute: function() {
      DOM = $__export("DOM", DOM);
      Object.defineProperty(setRootDomAdapter, "parameters", {get: function() {
        return [[DomAdapter]];
      }});
      DomAdapter = $__export("DomAdapter", (function() {
        var DomAdapter = function DomAdapter() {
          ;
        };
        return ($traceurRuntime.createClass)(DomAdapter, {
          get attrToPropMap() {
            throw _abstract();
          },
          parse: function(templateHtml) {
            assert.argumentTypes(templateHtml, assert.type.string);
            throw _abstract();
          },
          query: function(selector) {
            assert.argumentTypes(selector, assert.type.string);
            throw _abstract();
          },
          querySelector: function(el, selector) {
            assert.argumentTypes(el, assert.type.any, selector, assert.type.string);
            throw _abstract();
          },
          querySelectorAll: function(el, selector) {
            assert.argumentTypes(el, assert.type.any, selector, assert.type.string);
            throw _abstract();
          },
          on: function(el, evt, listener) {
            throw _abstract();
          },
          onAndCancel: function(el, evt, listener) {
            throw _abstract();
          },
          dispatchEvent: function(el, evt) {
            throw _abstract();
          },
          createMouseEvent: function(eventType) {
            throw _abstract();
          },
          createEvent: function(eventType) {
            throw _abstract();
          },
          getInnerHTML: function(el) {
            throw _abstract();
          },
          getOuterHTML: function(el) {
            throw _abstract();
          },
          nodeName: function(node) {
            throw _abstract();
          },
          nodeValue: function(node) {
            throw _abstract();
          },
          type: function(node) {
            throw _abstract();
          },
          content: function(node) {
            throw _abstract();
          },
          firstChild: function(el) {
            throw _abstract();
          },
          nextSibling: function(el) {
            throw _abstract();
          },
          parentElement: function(el) {
            throw _abstract();
          },
          childNodes: function(el) {
            throw _abstract();
          },
          childNodesAsList: function(el) {
            throw _abstract();
          },
          clearNodes: function(el) {
            throw _abstract();
          },
          appendChild: function(el, node) {
            throw _abstract();
          },
          removeChild: function(el, node) {
            throw _abstract();
          },
          replaceChild: function(el, newNode, oldNode) {
            throw _abstract();
          },
          remove: function(el) {
            throw _abstract();
          },
          insertBefore: function(el, node) {
            throw _abstract();
          },
          insertAllBefore: function(el, nodes) {
            throw _abstract();
          },
          insertAfter: function(el, node) {
            throw _abstract();
          },
          setInnerHTML: function(el, value) {
            throw _abstract();
          },
          getText: function(el) {
            throw _abstract();
          },
          setText: function(el, value) {
            assert.argumentTypes(el, assert.type.any, value, assert.type.string);
            throw _abstract();
          },
          getValue: function(el) {
            throw _abstract();
          },
          setValue: function(el, value) {
            assert.argumentTypes(el, assert.type.any, value, assert.type.string);
            throw _abstract();
          },
          getChecked: function(el) {
            throw _abstract();
          },
          setChecked: function(el, value) {
            assert.argumentTypes(el, assert.type.any, value, assert.type.boolean);
            throw _abstract();
          },
          createTemplate: function(html) {
            throw _abstract();
          },
          createElement: function(tagName) {
            var doc = arguments[1] !== (void 0) ? arguments[1] : null;
            throw _abstract();
          },
          createTextNode: function(text) {
            var doc = arguments[1] !== (void 0) ? arguments[1] : null;
            assert.argumentTypes(text, assert.type.string, doc, assert.type.any);
            throw _abstract();
          },
          createScriptTag: function(attrName, attrValue) {
            var doc = arguments[2] !== (void 0) ? arguments[2] : null;
            assert.argumentTypes(attrName, assert.type.string, attrValue, assert.type.string, doc, assert.type.any);
            throw _abstract();
          },
          createStyleElement: function(css) {
            var doc = arguments[1] !== (void 0) ? arguments[1] : null;
            assert.argumentTypes(css, assert.type.string, doc, assert.type.any);
            throw _abstract();
          },
          createShadowRoot: function(el) {
            throw _abstract();
          },
          getShadowRoot: function(el) {
            throw _abstract();
          },
          getHost: function(el) {
            throw _abstract();
          },
          getDistributedNodes: function(el) {
            throw _abstract();
          },
          clone: function(node) {
            throw _abstract();
          },
          hasProperty: function(element, name) {
            assert.argumentTypes(element, assert.type.any, name, assert.type.string);
            throw _abstract();
          },
          getElementsByClassName: function(element, name) {
            assert.argumentTypes(element, assert.type.any, name, assert.type.string);
            throw _abstract();
          },
          getElementsByTagName: function(element, name) {
            assert.argumentTypes(element, assert.type.any, name, assert.type.string);
            throw _abstract();
          },
          classList: function(element) {
            throw _abstract();
          },
          addClass: function(element, classname) {
            assert.argumentTypes(element, assert.type.any, classname, assert.type.string);
            throw _abstract();
          },
          removeClass: function(element, classname) {
            assert.argumentTypes(element, assert.type.any, classname, assert.type.string);
            throw _abstract();
          },
          hasClass: function(element, classname) {
            assert.argumentTypes(element, assert.type.any, classname, assert.type.string);
            throw _abstract();
          },
          setStyle: function(element, stylename, stylevalue) {
            assert.argumentTypes(element, assert.type.any, stylename, assert.type.string, stylevalue, assert.type.string);
            throw _abstract();
          },
          removeStyle: function(element, stylename) {
            assert.argumentTypes(element, assert.type.any, stylename, assert.type.string);
            throw _abstract();
          },
          getStyle: function(element, stylename) {
            assert.argumentTypes(element, assert.type.any, stylename, assert.type.string);
            throw _abstract();
          },
          tagName: function(element) {
            throw _abstract();
          },
          attributeMap: function(element) {
            throw _abstract();
          },
          getAttribute: function(element, attribute) {
            assert.argumentTypes(element, assert.type.any, attribute, assert.type.string);
            throw _abstract();
          },
          setAttribute: function(element, name, value) {
            assert.argumentTypes(element, assert.type.any, name, assert.type.string, value, assert.type.string);
            throw _abstract();
          },
          removeAttribute: function(element, attribute) {
            assert.argumentTypes(element, assert.type.any, attribute, assert.type.string);
            throw _abstract();
          },
          templateAwareRoot: function(el) {
            throw _abstract();
          },
          createHtmlDocument: function() {
            throw _abstract();
          },
          defaultDoc: function() {
            throw _abstract();
          },
          getBoundingClientRect: function(el) {
            throw _abstract();
          },
          getTitle: function() {
            throw _abstract();
          },
          setTitle: function(newTitle) {
            assert.argumentTypes(newTitle, assert.type.string);
            throw _abstract();
          },
          elementMatches: function(n, selector) {
            assert.argumentTypes(n, assert.type.any, selector, assert.type.string);
            throw _abstract();
          },
          isTemplateElement: function(el) {
            assert.argumentTypes(el, assert.type.any);
            throw _abstract();
          },
          isTextNode: function(node) {
            throw _abstract();
          },
          isCommentNode: function(node) {
            throw _abstract();
          },
          isElementNode: function(node) {
            throw _abstract();
          },
          hasShadowRoot: function(node) {
            throw _abstract();
          },
          isShadowRoot: function(node) {
            throw _abstract();
          },
          importIntoDoc: function(node) {
            throw _abstract();
          },
          isPageRule: function(rule) {
            throw _abstract();
          },
          isStyleRule: function(rule) {
            throw _abstract();
          },
          isMediaRule: function(rule) {
            throw _abstract();
          },
          isKeyframesRule: function(rule) {
            throw _abstract();
          },
          getHref: function(element) {
            throw _abstract();
          },
          getEventKey: function(event) {
            throw _abstract();
          },
          resolveAndSetHref: function(element, baseUrl, href) {
            assert.argumentTypes(element, assert.type.any, baseUrl, assert.type.string, href, assert.type.string);
            throw _abstract();
          },
          cssToRules: function(css) {
            assert.argumentTypes(css, assert.type.string);
            throw _abstract();
          },
          supportsDOMEvents: function() {
            throw _abstract();
          },
          supportsNativeShadowDOM: function() {
            throw _abstract();
          },
          getGlobalEventTarget: function(target) {
            assert.argumentTypes(target, assert.type.string);
            throw _abstract();
          }
        }, {});
      }()));
      Object.defineProperty(DomAdapter, "annotations", {get: function() {
        return [new ABSTRACT()];
      }});
      Object.defineProperty(DomAdapter.prototype.parse, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.query, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.querySelector, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.querySelectorAll, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.setText, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.setValue, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.setChecked, "parameters", {get: function() {
        return [[], [assert.type.boolean]];
      }});
      Object.defineProperty(DomAdapter.prototype.createTextNode, "parameters", {get: function() {
        return [[assert.type.string], []];
      }});
      Object.defineProperty(DomAdapter.prototype.createScriptTag, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], []];
      }});
      Object.defineProperty(DomAdapter.prototype.createStyleElement, "parameters", {get: function() {
        return [[assert.type.string], []];
      }});
      Object.defineProperty(DomAdapter.prototype.hasProperty, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.getElementsByClassName, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.getElementsByTagName, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.addClass, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.removeClass, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.hasClass, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.setStyle, "parameters", {get: function() {
        return [[], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.removeStyle, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.getStyle, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.getAttribute, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.setAttribute, "parameters", {get: function() {
        return [[], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.removeAttribute, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.setTitle, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.elementMatches, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.isTemplateElement, "parameters", {get: function() {
        return [[assert.type.any]];
      }});
      Object.defineProperty(DomAdapter.prototype.resolveAndSetHref, "parameters", {get: function() {
        return [[], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.cssToRules, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(DomAdapter.prototype.getGlobalEventTarget, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
    }
  };
});

System.register("angular2/src/dom/generic_browser_adapter", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/src/dom/dom_adapter"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/dom/generic_browser_adapter";
  var assert,
    ABSTRACT,
    List,
    ListWrapper,
    isPresent,
    isFunction,
    DomAdapter,
    GenericBrowserDomAdapter;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      ABSTRACT = $__m.ABSTRACT;
      isPresent = $__m.isPresent;
      isFunction = $__m.isFunction;
    }, function($__m) {
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
    }, function($__m) {
      DomAdapter = $__m.DomAdapter;
    }],
    execute: function() {
      GenericBrowserDomAdapter = $__export("GenericBrowserDomAdapter", (function($__super) {
        var GenericBrowserDomAdapter = function GenericBrowserDomAdapter() {
          $traceurRuntime.superConstructor(GenericBrowserDomAdapter).apply(this, arguments);
          ;
        };
        return ($traceurRuntime.createClass)(GenericBrowserDomAdapter, {
          getDistributedNodes: function(el) {
            return el.getDistributedNodes();
          },
          resolveAndSetHref: function(el, baseUrl, href) {
            assert.argumentTypes(el, assert.type.any, baseUrl, assert.type.string, href, assert.type.string);
            el.href = href == null ? baseUrl : baseUrl + '/../' + href;
          },
          cssToRules: function(css) {
            assert.argumentTypes(css, assert.type.string);
            var style = this.createStyleElement(css);
            this.appendChild(this.defaultDoc().head, style);
            var rules = ListWrapper.create();
            if (isPresent(style.sheet)) {
              try {
                var rawRules = style.sheet.cssRules;
                rules = ListWrapper.createFixedSize(rawRules.length);
                for (var i = 0; i < rawRules.length; i++) {
                  rules[i] = rawRules[i];
                }
              } catch (e) {}
            } else {}
            this.remove(style);
            return assert.returnType((rules), List);
          },
          supportsDOMEvents: function() {
            return assert.returnType((true), assert.type.boolean);
          },
          supportsNativeShadowDOM: function() {
            return assert.returnType((isFunction(this.defaultDoc().body.createShadowRoot)), assert.type.boolean);
          }
        }, {}, $__super);
      }(DomAdapter)));
      Object.defineProperty(GenericBrowserDomAdapter, "annotations", {get: function() {
        return [new ABSTRACT()];
      }});
      Object.defineProperty(GenericBrowserDomAdapter.prototype.resolveAndSetHref, "parameters", {get: function() {
        return [[], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(GenericBrowserDomAdapter.prototype.cssToRules, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
    }
  };
});

System.register("angular2/src/core/compiler/directive_metadata", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/src/core/annotations/annotations", "angular2/di"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/compiler/directive_metadata";
  var assert,
    Type,
    List,
    DirectiveAnnotation,
    ResolvedBinding,
    DirectiveMetadata;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Type = $__m.Type;
    }, function($__m) {
      List = $__m.List;
    }, function($__m) {
      DirectiveAnnotation = $__m.DirectiveAnnotation;
    }, function($__m) {
      ResolvedBinding = $__m.ResolvedBinding;
    }],
    execute: function() {
      DirectiveMetadata = $__export("DirectiveMetadata", (function() {
        var DirectiveMetadata = function DirectiveMetadata(type, annotation, resolvedInjectables) {
          assert.argumentTypes(type, Type, annotation, DirectiveAnnotation, resolvedInjectables, assert.genericType(List, ResolvedBinding));
          this.annotation = annotation;
          this.type = type;
          this.resolvedInjectables = resolvedInjectables;
        };
        return ($traceurRuntime.createClass)(DirectiveMetadata, {}, {});
      }()));
      Object.defineProperty(DirectiveMetadata, "parameters", {get: function() {
        return [[Type], [DirectiveAnnotation], [assert.genericType(List, ResolvedBinding)]];
      }});
    }
  };
});

System.register("angular2/src/facade/math", ["angular2/src/facade/lang"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/facade/math";
  var global,
    Math,
    NaN;
  return {
    setters: [function($__m) {
      global = $__m.global;
    }],
    execute: function() {
      Math = $__export("Math", global.Math);
      NaN = $__export("NaN", global.NaN);
    }
  };
});

System.register("angular2/src/core/annotations/di", ["angular2/src/facade/lang", "angular2/di"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/annotations/di";
  var CONST,
    DependencyAnnotation,
    PropertySetter,
    Attribute,
    Query;
  return {
    setters: [function($__m) {
      CONST = $__m.CONST;
    }, function($__m) {
      DependencyAnnotation = $__m.DependencyAnnotation;
    }],
    execute: function() {
      PropertySetter = $__export("PropertySetter", (function($__super) {
        var PropertySetter = function PropertySetter(propName) {
          $traceurRuntime.superConstructor(PropertySetter).call(this);
          this.propName = propName;
        };
        return ($traceurRuntime.createClass)(PropertySetter, {get token() {
          return Function;
        }}, {}, $__super);
      }(DependencyAnnotation)));
      Object.defineProperty(PropertySetter, "annotations", {get: function() {
        return [new CONST()];
      }});
      Attribute = $__export("Attribute", (function($__super) {
        var Attribute = function Attribute(attributeName) {
          $traceurRuntime.superConstructor(Attribute).call(this);
          this.attributeName = attributeName;
        };
        return ($traceurRuntime.createClass)(Attribute, {get token() {
          return this;
        }}, {}, $__super);
      }(DependencyAnnotation)));
      Object.defineProperty(Attribute, "annotations", {get: function() {
        return [new CONST()];
      }});
      Query = $__export("Query", (function($__super) {
        var Query = function Query(directive) {
          $traceurRuntime.superConstructor(Query).call(this);
          this.directive = directive;
        };
        return ($traceurRuntime.createClass)(Query, {}, {}, $__super);
      }(DependencyAnnotation)));
      Object.defineProperty(Query, "annotations", {get: function() {
        return [new CONST()];
      }});
    }
  };
});

System.register("angular2/src/render/api", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/async", "angular2/src/facade/collection", "angular2/change_detection"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/api";
  var assert,
    isPresent,
    Promise,
    List,
    Map,
    ASTWithSource,
    EventBinding,
    ElementBinder,
    DirectiveBinder,
    ProtoViewDto,
    DirectiveMetadata,
    ProtoViewRef,
    ViewRef,
    ViewContainerRef,
    ViewDefinition,
    Renderer,
    EventDispatcher;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isPresent = $__m.isPresent;
    }, function($__m) {
      Promise = $__m.Promise;
    }, function($__m) {
      List = $__m.List;
      Map = $__m.Map;
    }, function($__m) {
      ASTWithSource = $__m.ASTWithSource;
    }],
    execute: function() {
      EventBinding = $__export("EventBinding", (function() {
        var EventBinding = function EventBinding(fullName, source) {
          assert.argumentTypes(fullName, assert.type.string, source, ASTWithSource);
          this.fullName = fullName;
          this.source = source;
        };
        return ($traceurRuntime.createClass)(EventBinding, {}, {});
      }()));
      Object.defineProperty(EventBinding, "parameters", {get: function() {
        return [[assert.type.string], [ASTWithSource]];
      }});
      ElementBinder = $__export("ElementBinder", (function() {
        var ElementBinder = function ElementBinder($__1) {
          var $__2 = $__1,
            index = $__2.index,
            parentIndex = $__2.parentIndex,
            distanceToParent = $__2.distanceToParent,
            directives = $__2.directives,
            nestedProtoView = $__2.nestedProtoView,
            propertyBindings = $__2.propertyBindings,
            variableBindings = $__2.variableBindings,
            eventBindings = $__2.eventBindings,
            textBindings = $__2.textBindings,
            readAttributes = $__2.readAttributes;
          this.index = index;
          this.parentIndex = parentIndex;
          this.distanceToParent = distanceToParent;
          this.directives = directives;
          this.nestedProtoView = nestedProtoView;
          this.propertyBindings = propertyBindings;
          this.variableBindings = variableBindings;
          this.eventBindings = eventBindings;
          this.textBindings = textBindings;
          this.readAttributes = readAttributes;
        };
        return ($traceurRuntime.createClass)(ElementBinder, {}, {});
      }()));
      DirectiveBinder = $__export("DirectiveBinder", (function() {
        var DirectiveBinder = function DirectiveBinder($__1) {
          var $__2 = $__1,
            directiveIndex = $__2.directiveIndex,
            propertyBindings = $__2.propertyBindings,
            eventBindings = $__2.eventBindings;
          this.directiveIndex = directiveIndex;
          this.propertyBindings = propertyBindings;
          this.eventBindings = eventBindings;
        };
        return ($traceurRuntime.createClass)(DirectiveBinder, {}, {});
      }()));
      ProtoViewDto = $__export("ProtoViewDto", (function() {
        var ProtoViewDto = function ProtoViewDto() {
          var $__1 = arguments[0] !== (void 0) ? arguments[0] : {},
            render = $__1.render,
            elementBinders = $__1.elementBinders,
            variableBindings = $__1.variableBindings,
            type = $__1.type;
          this.render = render;
          this.elementBinders = elementBinders;
          this.variableBindings = variableBindings;
          this.type = type;
        };
        return ($traceurRuntime.createClass)(ProtoViewDto, {}, {
          get HOST_VIEW_TYPE() {
            return 0;
          },
          get COMPONENT_VIEW_TYPE() {
            return 1;
          },
          get EMBEDDED_VIEW_TYPE() {
            return 1;
          }
        });
      }()));
      DirectiveMetadata = $__export("DirectiveMetadata", (function() {
        var DirectiveMetadata = function DirectiveMetadata($__1) {
          var $__2 = $__1,
            id = $__2.id,
            selector = $__2.selector,
            compileChildren = $__2.compileChildren,
            hostListeners = $__2.hostListeners,
            properties = $__2.properties,
            setters = $__2.setters,
            readAttributes = $__2.readAttributes,
            type = $__2.type;
          this.id = id;
          this.selector = selector;
          this.compileChildren = isPresent(compileChildren) ? compileChildren : true;
          this.hostListeners = hostListeners;
          this.properties = properties;
          this.setters = setters;
          this.readAttributes = readAttributes;
          this.type = type;
        };
        return ($traceurRuntime.createClass)(DirectiveMetadata, {}, {
          get DECORATOR_TYPE() {
            return 0;
          },
          get COMPONENT_TYPE() {
            return 1;
          },
          get VIEWPORT_TYPE() {
            return 2;
          }
        });
      }()));
      ProtoViewRef = $__export("ProtoViewRef", (function() {
        var ProtoViewRef = function ProtoViewRef() {
          ;
        };
        return ($traceurRuntime.createClass)(ProtoViewRef, {}, {});
      }()));
      ViewRef = $__export("ViewRef", (function() {
        var ViewRef = function ViewRef() {
          ;
        };
        return ($traceurRuntime.createClass)(ViewRef, {}, {});
      }()));
      ViewContainerRef = $__export("ViewContainerRef", (function() {
        var ViewContainerRef = function ViewContainerRef(view, elementIndex) {
          assert.argumentTypes(view, ViewRef, elementIndex, assert.type.number);
          this.view = view;
          this.elementIndex = elementIndex;
        };
        return ($traceurRuntime.createClass)(ViewContainerRef, {}, {});
      }()));
      Object.defineProperty(ViewContainerRef, "parameters", {get: function() {
        return [[ViewRef], [assert.type.number]];
      }});
      ViewDefinition = $__export("ViewDefinition", (function() {
        var ViewDefinition = function ViewDefinition($__1) {
          var $__2 = $__1,
            componentId = $__2.componentId,
            absUrl = $__2.absUrl,
            template = $__2.template,
            directives = $__2.directives;
          this.componentId = componentId;
          this.absUrl = absUrl;
          this.template = template;
          this.directives = directives;
        };
        return ($traceurRuntime.createClass)(ViewDefinition, {}, {});
      }()));
      Renderer = $__export("Renderer", (function() {
        var Renderer = function Renderer() {
          ;
        };
        return ($traceurRuntime.createClass)(Renderer, {
          createHostProtoView: function(componentId) {
            return assert.returnType((null), assert.genericType(Promise, ProtoViewDto));
          },
          compile: function(template) {
            assert.argumentTypes(template, ViewDefinition);
            return assert.returnType((null), assert.genericType(Promise, ProtoViewDto));
          },
          mergeChildComponentProtoViews: function(protoViewRef, componentProtoViewRefs) {
            assert.argumentTypes(protoViewRef, ProtoViewRef, componentProtoViewRefs, assert.genericType(List, ProtoViewRef));
            return null;
          },
          createViewInContainer: function(vcRef, atIndex, protoViewRef) {
            assert.argumentTypes(vcRef, ViewContainerRef, atIndex, assert.type.number, protoViewRef, ProtoViewRef);
            return assert.returnType((null), assert.genericType(List, ViewRef));
          },
          destroyViewInContainer: function(vcRef, atIndex) {
            assert.argumentTypes(vcRef, ViewContainerRef, atIndex, assert.type.number);
          },
          insertViewIntoContainer: function(vcRef, atIndex, view) {
            assert.argumentTypes(vcRef, ViewContainerRef, atIndex, assert.type.number, view, ViewRef);
          },
          detachViewFromContainer: function(vcRef, atIndex) {
            assert.argumentTypes(vcRef, ViewContainerRef, atIndex, assert.type.number);
          },
          createDynamicComponentView: function(hostViewRef, elementIndex, componentProtoViewRef) {
            assert.argumentTypes(hostViewRef, ViewRef, elementIndex, assert.type.number, componentProtoViewRef, ProtoViewRef);
            return assert.returnType((null), assert.genericType(List, ViewRef));
          },
          destroyDynamicComponentView: function(hostViewRef, elementIndex) {
            assert.argumentTypes(hostViewRef, ViewRef, elementIndex, assert.type.number);
          },
          createInPlaceHostView: function(parentViewRef, hostElementSelector, hostProtoViewRef) {
            assert.argumentTypes(parentViewRef, ViewRef, hostElementSelector, assert.type.any, hostProtoViewRef, ProtoViewRef);
            return assert.returnType((null), assert.genericType(List, ViewRef));
          },
          destroyInPlaceHostView: function(parentViewRef, hostViewRef) {
            assert.argumentTypes(parentViewRef, ViewRef, hostViewRef, ViewRef);
          },
          setElementProperty: function(view, elementIndex, propertyName, propertyValue) {
            assert.argumentTypes(view, ViewRef, elementIndex, assert.type.number, propertyName, assert.type.string, propertyValue, assert.type.any);
          },
          setText: function(view, textNodeIndex, text) {
            assert.argumentTypes(view, ViewRef, textNodeIndex, assert.type.number, text, assert.type.string);
          },
          setEventDispatcher: function(viewRef, dispatcher) {
            assert.argumentTypes(viewRef, ViewRef, dispatcher, assert.type.any);
          },
          flush: function() {}
        }, {});
      }()));
      Object.defineProperty(Renderer.prototype.compile, "parameters", {get: function() {
        return [[ViewDefinition]];
      }});
      Object.defineProperty(Renderer.prototype.mergeChildComponentProtoViews, "parameters", {get: function() {
        return [[ProtoViewRef], [assert.genericType(List, ProtoViewRef)]];
      }});
      Object.defineProperty(Renderer.prototype.createViewInContainer, "parameters", {get: function() {
        return [[ViewContainerRef], [assert.type.number], [ProtoViewRef]];
      }});
      Object.defineProperty(Renderer.prototype.destroyViewInContainer, "parameters", {get: function() {
        return [[ViewContainerRef], [assert.type.number]];
      }});
      Object.defineProperty(Renderer.prototype.insertViewIntoContainer, "parameters", {get: function() {
        return [[ViewContainerRef], [assert.type.number], [ViewRef]];
      }});
      Object.defineProperty(Renderer.prototype.detachViewFromContainer, "parameters", {get: function() {
        return [[ViewContainerRef], [assert.type.number]];
      }});
      Object.defineProperty(Renderer.prototype.createDynamicComponentView, "parameters", {get: function() {
        return [[ViewRef], [assert.type.number], [ProtoViewRef]];
      }});
      Object.defineProperty(Renderer.prototype.destroyDynamicComponentView, "parameters", {get: function() {
        return [[ViewRef], [assert.type.number]];
      }});
      Object.defineProperty(Renderer.prototype.createInPlaceHostView, "parameters", {get: function() {
        return [[ViewRef], [], [ProtoViewRef]];
      }});
      Object.defineProperty(Renderer.prototype.destroyInPlaceHostView, "parameters", {get: function() {
        return [[ViewRef], [ViewRef]];
      }});
      Object.defineProperty(Renderer.prototype.setElementProperty, "parameters", {get: function() {
        return [[ViewRef], [assert.type.number], [assert.type.string], [assert.type.any]];
      }});
      Object.defineProperty(Renderer.prototype.setText, "parameters", {get: function() {
        return [[ViewRef], [assert.type.number], [assert.type.string]];
      }});
      Object.defineProperty(Renderer.prototype.setEventDispatcher, "parameters", {get: function() {
        return [[ViewRef], [assert.type.any]];
      }});
      EventDispatcher = $__export("EventDispatcher", (function() {
        var EventDispatcher = function EventDispatcher() {
          ;
        };
        return ($traceurRuntime.createClass)(EventDispatcher, {dispatchEvent: function(elementIndex, eventName, locals) {
          assert.argumentTypes(elementIndex, assert.type.number, eventName, assert.type.string, locals, assert.genericType(Map, assert.type.string, assert.type.any));
        }}, {});
      }()));
      Object.defineProperty(EventDispatcher.prototype.dispatchEvent, "parameters", {get: function() {
        return [[assert.type.number], [assert.type.string], [assert.genericType(Map, assert.type.string, assert.type.any)]];
      }});
    }
  };
});

System.register("angular2/src/render/dom/view/view_container", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/src/dom/dom_adapter", "angular2/src/render/dom/view/view"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/view/view_container";
  var assert,
    isPresent,
    isBlank,
    BaseException,
    ListWrapper,
    MapWrapper,
    List,
    DOM,
    viewModule,
    ViewContainer;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isPresent = $__m.isPresent;
      isBlank = $__m.isBlank;
      BaseException = $__m.BaseException;
    }, function($__m) {
      ListWrapper = $__m.ListWrapper;
      MapWrapper = $__m.MapWrapper;
      List = $__m.List;
    }, function($__m) {
      DOM = $__m.DOM;
    }, function($__m) {
      viewModule = $__m;
    }],
    execute: function() {
      ViewContainer = $__export("ViewContainer", (function() {
        var ViewContainer = function ViewContainer(parentView, boundElementIndex) {
          assert.argumentTypes(parentView, viewModule.RenderView, boundElementIndex, assert.type.number);
          this.parentView = parentView;
          this.boundElementIndex = boundElementIndex;
          this.views = [];
        };
        return ($traceurRuntime.createClass)(ViewContainer, {
          get: function(index) {
            assert.argumentTypes(index, assert.type.number);
            return assert.returnType((this.views[index]), viewModule.RenderView);
          },
          size: function() {
            return this.views.length;
          },
          _siblingToInsertAfter: function(index) {
            assert.argumentTypes(index, assert.type.number);
            if (index == 0)
              return this.parentView.boundElements[this.boundElementIndex];
            return ListWrapper.last(this.views[index - 1].rootNodes);
          },
          _checkHydrated: function() {
            if (!this.parentView.hydrated)
              throw new BaseException('Cannot change dehydrated ViewContainer');
          },
          _getDirectParentLightDom: function() {
            return this.parentView.getDirectParentLightDom(this.boundElementIndex);
          },
          clear: function() {
            this._checkHydrated();
            for (var i = this.views.length - 1; i >= 0; i--) {
              this.detach(i);
            }
            if (isPresent(this._getDirectParentLightDom())) {
              this._getDirectParentLightDom().redistribute();
            }
          },
          insert: function(view) {
            var atIndex = arguments[1] !== (void 0) ? arguments[1] : -1;
            this._checkHydrated();
            if (atIndex == -1)
              atIndex = this.views.length;
            ListWrapper.insert(this.views, atIndex, view);
            if (isBlank(this._getDirectParentLightDom())) {
              ViewContainer.moveViewNodesAfterSibling(this._siblingToInsertAfter(atIndex), view);
            } else {
              this._getDirectParentLightDom().redistribute();
            }
            if (isPresent(this.parentView.hostLightDom)) {
              this.parentView.hostLightDom.redistribute();
            }
            return assert.returnType((view), viewModule.RenderView);
          },
          detach: function(atIndex) {
            assert.argumentTypes(atIndex, assert.type.number);
            this._checkHydrated();
            var detachedView = this.get(atIndex);
            ListWrapper.removeAt(this.views, atIndex);
            if (isBlank(this._getDirectParentLightDom())) {
              ViewContainer.removeViewNodes(detachedView);
            } else {
              this._getDirectParentLightDom().redistribute();
            }
            if (isPresent(this.parentView.hostLightDom)) {
              this.parentView.hostLightDom.redistribute();
            }
            return detachedView;
          },
          contentTagContainers: function() {
            return this.views;
          },
          nodes: function() {
            var r = [];
            for (var i = 0; i < this.views.length; ++i) {
              r = ListWrapper.concat(r, this.views[i].rootNodes);
            }
            return assert.returnType((r), List);
          }
        }, {
          moveViewNodesAfterSibling: function(sibling, view) {
            for (var i = view.rootNodes.length - 1; i >= 0; --i) {
              DOM.insertAfter(sibling, view.rootNodes[i]);
            }
          },
          removeViewNodes: function(view) {
            var len = view.rootNodes.length;
            if (len == 0)
              return ;
            var parent = view.rootNodes[0].parentNode;
            for (var i = len - 1; i >= 0; --i) {
              DOM.removeChild(parent, view.rootNodes[i]);
            }
          }
        });
      }()));
      Object.defineProperty(ViewContainer, "parameters", {get: function() {
        return [[viewModule.RenderView], [assert.type.number]];
      }});
      Object.defineProperty(ViewContainer.prototype.get, "parameters", {get: function() {
        return [[assert.type.number]];
      }});
      Object.defineProperty(ViewContainer.prototype._siblingToInsertAfter, "parameters", {get: function() {
        return [[assert.type.number]];
      }});
      Object.defineProperty(ViewContainer.prototype.detach, "parameters", {get: function() {
        return [[assert.type.number]];
      }});
    }
  };
});

System.register("angular2/src/render/dom/view/element_binder", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/change_detection", "angular2/src/reflection/types", "angular2/src/facade/collection", "angular2/src/render/dom/view/proto_view"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/view/element_binder";
  var assert,
    isBlank,
    isPresent,
    AST,
    SetterFn,
    List,
    ListWrapper,
    protoViewModule,
    ElementBinder,
    Event;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isBlank = $__m.isBlank;
      isPresent = $__m.isPresent;
    }, function($__m) {
      AST = $__m.AST;
    }, function($__m) {
      SetterFn = $__m.SetterFn;
    }, function($__m) {
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
    }, function($__m) {
      protoViewModule = $__m;
    }],
    execute: function() {
      ElementBinder = $__export("ElementBinder", (function() {
        var ElementBinder = function ElementBinder() {
          var $__1 = arguments[0] !== (void 0) ? arguments[0] : {},
            textNodeIndices = $__1.textNodeIndices,
            contentTagSelector = $__1.contentTagSelector,
            nestedProtoView = $__1.nestedProtoView,
            componentId = $__1.componentId,
            eventLocals = $__1.eventLocals,
            localEvents = $__1.localEvents,
            globalEvents = $__1.globalEvents,
            parentIndex = $__1.parentIndex,
            distanceToParent = $__1.distanceToParent,
            propertySetters = $__1.propertySetters;
          this.textNodeIndices = textNodeIndices;
          this.contentTagSelector = contentTagSelector;
          this.nestedProtoView = nestedProtoView;
          this.componentId = componentId;
          this.eventLocals = eventLocals;
          this.localEvents = localEvents;
          this.globalEvents = globalEvents;
          this.parentIndex = parentIndex;
          this.distanceToParent = distanceToParent;
          this.propertySetters = propertySetters;
        };
        return ($traceurRuntime.createClass)(ElementBinder, {
          hasStaticComponent: function() {
            return isPresent(this.componentId) && isPresent(this.nestedProtoView);
          },
          hasDynamicComponent: function() {
            return isPresent(this.componentId) && isBlank(this.nestedProtoView);
          }
        }, {});
      }()));
      Event = $__export("Event", (function() {
        var Event = function Event(name, target, fullName) {
          assert.argumentTypes(name, assert.type.string, target, assert.type.string, fullName, assert.type.string);
          this.name = name;
          this.target = target;
          this.fullName = fullName;
        };
        return ($traceurRuntime.createClass)(Event, {}, {});
      }()));
      Object.defineProperty(Event, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string]];
      }});
    }
  };
});

System.register("angular2/src/render/dom/util", ["rtts_assert/rtts_assert", "angular2/src/facade/lang"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/util";
  var assert,
    StringWrapper,
    RegExpWrapper,
    isPresent,
    NG_BINDING_CLASS_SELECTOR,
    NG_BINDING_CLASS,
    EVENT_TARGET_SEPARATOR,
    CAMEL_CASE_REGEXP,
    DASH_CASE_REGEXP;
  function camelCaseToDashCase(input) {
    assert.argumentTypes(input, assert.type.string);
    return StringWrapper.replaceAllMapped(input, CAMEL_CASE_REGEXP, (function(m) {
      return '-' + m[1].toLowerCase();
    }));
  }
  function dashCaseToCamelCase(input) {
    assert.argumentTypes(input, assert.type.string);
    return StringWrapper.replaceAllMapped(input, DASH_CASE_REGEXP, (function(m) {
      return m[1].toUpperCase();
    }));
  }
  $__export("camelCaseToDashCase", camelCaseToDashCase);
  $__export("dashCaseToCamelCase", dashCaseToCamelCase);
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      StringWrapper = $__m.StringWrapper;
      RegExpWrapper = $__m.RegExpWrapper;
      isPresent = $__m.isPresent;
    }],
    execute: function() {
      NG_BINDING_CLASS_SELECTOR = $__export("NG_BINDING_CLASS_SELECTOR", '.ng-binding');
      NG_BINDING_CLASS = $__export("NG_BINDING_CLASS", 'ng-binding');
      EVENT_TARGET_SEPARATOR = $__export("EVENT_TARGET_SEPARATOR", ':');
      CAMEL_CASE_REGEXP = RegExpWrapper.create('([A-Z])');
      DASH_CASE_REGEXP = RegExpWrapper.create('-([a-z])');
      Object.defineProperty(camelCaseToDashCase, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(dashCaseToCamelCase, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
    }
  };
});

System.register("angular2/src/render/dom/shadow_dom/content_tag", ["rtts_assert/rtts_assert", "angular2/src/render/dom/shadow_dom/light_dom", "angular2/src/dom/dom_adapter", "angular2/src/facade/lang", "angular2/src/facade/collection"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/shadow_dom/content_tag";
  var assert,
    ldModule,
    DOM,
    isPresent,
    List,
    ListWrapper,
    ContentStrategy,
    RenderedContent,
    IntermediateContent,
    Content;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      ldModule = $__m;
    }, function($__m) {
      DOM = $__m.DOM;
    }, function($__m) {
      isPresent = $__m.isPresent;
    }, function($__m) {
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
    }],
    execute: function() {
      ContentStrategy = (function() {
        var ContentStrategy = function ContentStrategy() {
          ;
        };
        return ($traceurRuntime.createClass)(ContentStrategy, {insert: function(nodes) {
          assert.argumentTypes(nodes, List);
        }}, {});
      }());
      Object.defineProperty(ContentStrategy.prototype.insert, "parameters", {get: function() {
        return [[List]];
      }});
      RenderedContent = (function($__super) {
        var RenderedContent = function RenderedContent(contentEl) {
          $traceurRuntime.superConstructor(RenderedContent).call(this);
          this.beginScript = contentEl;
          this.endScript = DOM.nextSibling(this.beginScript);
          this.nodes = [];
        };
        return ($traceurRuntime.createClass)(RenderedContent, {
          insert: function(nodes) {
            assert.argumentTypes(nodes, List);
            this.nodes = nodes;
            DOM.insertAllBefore(this.endScript, nodes);
            this._removeNodesUntil(ListWrapper.isEmpty(nodes) ? this.endScript : nodes[0]);
          },
          _removeNodesUntil: function(node) {
            var p = DOM.parentElement(this.beginScript);
            for (var next = DOM.nextSibling(this.beginScript); next !== node; next = DOM.nextSibling(this.beginScript)) {
              DOM.removeChild(p, next);
            }
          }
        }, {}, $__super);
      }(ContentStrategy));
      Object.defineProperty(RenderedContent.prototype.insert, "parameters", {get: function() {
        return [[List]];
      }});
      IntermediateContent = (function($__super) {
        var IntermediateContent = function IntermediateContent(destinationLightDom) {
          assert.argumentTypes(destinationLightDom, ldModule.LightDom);
          $traceurRuntime.superConstructor(IntermediateContent).call(this);
          this.nodes = [];
          this.destinationLightDom = destinationLightDom;
        };
        return ($traceurRuntime.createClass)(IntermediateContent, {insert: function(nodes) {
          assert.argumentTypes(nodes, List);
          this.nodes = nodes;
          this.destinationLightDom.redistribute();
        }}, {}, $__super);
      }(ContentStrategy));
      Object.defineProperty(IntermediateContent, "parameters", {get: function() {
        return [[ldModule.LightDom]];
      }});
      Object.defineProperty(IntermediateContent.prototype.insert, "parameters", {get: function() {
        return [[List]];
      }});
      Content = $__export("Content", (function() {
        var Content = function Content(contentStartEl, selector) {
          assert.argumentTypes(contentStartEl, assert.type.any, selector, assert.type.string);
          this.select = selector;
          this.contentStartElement = contentStartEl;
          this._strategy = null;
        };
        return ($traceurRuntime.createClass)(Content, {
          hydrate: function(destinationLightDom) {
            assert.argumentTypes(destinationLightDom, ldModule.LightDom);
            this._strategy = isPresent(destinationLightDom) ? new IntermediateContent(destinationLightDom) : new RenderedContent(this.contentStartElement);
          },
          dehydrate: function() {
            this._strategy = null;
          },
          nodes: function() {
            return assert.returnType((this._strategy.nodes), List);
          },
          insert: function(nodes) {
            assert.argumentTypes(nodes, List);
            this._strategy.insert(nodes);
          }
        }, {});
      }()));
      Object.defineProperty(Content, "parameters", {get: function() {
        return [[], [assert.type.string]];
      }});
      Object.defineProperty(Content.prototype.hydrate, "parameters", {get: function() {
        return [[ldModule.LightDom]];
      }});
      Object.defineProperty(Content.prototype.insert, "parameters", {get: function() {
        return [[List]];
      }});
    }
  };
});

System.register("angular2/src/render/dom/shadow_dom/shadow_dom_strategy", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/async", "angular2/src/render/dom/view/view", "angular2/src/render/dom/shadow_dom/light_dom"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/shadow_dom/shadow_dom_strategy";
  var assert,
    isBlank,
    isPresent,
    Promise,
    viewModule,
    LightDom,
    ShadowDomStrategy;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isBlank = $__m.isBlank;
      isPresent = $__m.isPresent;
    }, function($__m) {
      Promise = $__m.Promise;
    }, function($__m) {
      viewModule = $__m;
    }, function($__m) {
      LightDom = $__m.LightDom;
    }],
    execute: function() {
      ShadowDomStrategy = $__export("ShadowDomStrategy", (function() {
        var ShadowDomStrategy = function ShadowDomStrategy() {
          ;
        };
        return ($traceurRuntime.createClass)(ShadowDomStrategy, {
          hasNativeContentElement: function() {
            return assert.returnType((true), assert.type.boolean);
          },
          attachTemplate: function(el, view) {
            assert.argumentTypes(el, assert.type.any, view, viewModule.RenderView);
          },
          constructLightDom: function(lightDomView, shadowDomView, el) {
            assert.argumentTypes(lightDomView, viewModule.RenderView, shadowDomView, viewModule.RenderView, el, assert.type.any);
            return assert.returnType((null), LightDom);
          },
          processStyleElement: function(hostComponentId, templateUrl, styleElement) {
            assert.argumentTypes(hostComponentId, assert.type.string, templateUrl, assert.type.string, styleElement, assert.type.any);
            return assert.returnType((null), Promise);
          },
          processElement: function(hostComponentId, elementComponentId, element) {
            assert.argumentTypes(hostComponentId, assert.type.string, elementComponentId, assert.type.string, element, assert.type.any);
          }
        }, {});
      }()));
      Object.defineProperty(ShadowDomStrategy.prototype.attachTemplate, "parameters", {get: function() {
        return [[], [viewModule.RenderView]];
      }});
      Object.defineProperty(ShadowDomStrategy.prototype.constructLightDom, "parameters", {get: function() {
        return [[viewModule.RenderView], [viewModule.RenderView], []];
      }});
      Object.defineProperty(ShadowDomStrategy.prototype.processStyleElement, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], []];
      }});
      Object.defineProperty(ShadowDomStrategy.prototype.processElement, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], []];
      }});
    }
  };
});

System.register("angular2/src/core/zone/vm_turn_zone", ["angular2/src/facade/collection", "angular2/src/facade/lang"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/zone/vm_turn_zone";
  var List,
    ListWrapper,
    StringMapWrapper,
    normalizeBlank,
    isPresent,
    global,
    VmTurnZone;
  return {
    setters: [function($__m) {
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
      StringMapWrapper = $__m.StringMapWrapper;
    }, function($__m) {
      normalizeBlank = $__m.normalizeBlank;
      isPresent = $__m.isPresent;
      global = $__m.global;
    }],
    execute: function() {
      VmTurnZone = $__export("VmTurnZone", (function() {
        var VmTurnZone = function VmTurnZone($__2) {
          var enableLongStackTrace = $__2.enableLongStackTrace;
          this._nestedRunCounter = 0;
          this._onTurnStart = null;
          this._onTurnDone = null;
          this._onErrorHandler = null;
          this._outerZone = global.zone;
          this._innerZone = this._createInnerZone(this._outerZone, enableLongStackTrace);
        };
        return ($traceurRuntime.createClass)(VmTurnZone, {
          initCallbacks: function() {
            var $__2 = arguments[0] !== (void 0) ? arguments[0] : {},
              onTurnStart = $__2.onTurnStart,
              onTurnDone = $__2.onTurnDone,
              onScheduleMicrotask = $__2.onScheduleMicrotask,
              onErrorHandler = $__2.onErrorHandler;
            this._onTurnStart = normalizeBlank(onTurnStart);
            this._onTurnDone = normalizeBlank(onTurnDone);
            this._onErrorHandler = normalizeBlank(onErrorHandler);
          },
          run: function(fn) {
            return this._innerZone.run(fn);
          },
          runOutsideAngular: function(fn) {
            return this._outerZone.run(fn);
          },
          _createInnerZone: function(zone, enableLongStackTrace) {
            var $__0 = this;
            var vmTurnZone = this;
            var errorHandling;
            if (enableLongStackTrace) {
              errorHandling = StringMapWrapper.merge(Zone.longStackTraceZone, {onError: function(e) {
                vmTurnZone._onError(this, e);
              }});
            } else {
              errorHandling = {onError: function(e) {
                vmTurnZone._onError(this, e);
              }};
            }
            return zone.fork(errorHandling).fork({
              beforeTask: (function() {
                $__0._beforeTask();
              }),
              afterTask: (function() {
                $__0._afterTask();
              })
            });
          },
          _beforeTask: function() {
            this._nestedRunCounter++;
            if (this._nestedRunCounter === 1 && this._onTurnStart) {
              this._onTurnStart();
            }
          },
          _afterTask: function() {
            this._nestedRunCounter--;
            if (this._nestedRunCounter === 0 && this._onTurnDone) {
              this._onTurnDone();
            }
          },
          _onError: function(zone, e) {
            if (isPresent(this._onErrorHandler)) {
              var trace = [normalizeBlank(e.stack)];
              while (zone && zone.constructedAtException) {
                trace.push(zone.constructedAtException.get());
                zone = zone.parent;
              }
              this._onErrorHandler(e, trace);
            } else {
              throw e;
            }
          }
        }, {});
      }()));
    }
  };
});

System.register("angular2/src/render/dom/view/view_hydrator", ["rtts_assert/rtts_assert", "angular2/di", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/src/render/dom/shadow_dom/light_dom", "angular2/src/render/dom/events/event_manager", "angular2/src/render/dom/view/view_factory", "angular2/src/render/dom/view/view_container", "angular2/src/render/dom/view/view"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/view/view_hydrator";
  var assert,
    Injectable,
    int,
    isPresent,
    isBlank,
    BaseException,
    ListWrapper,
    MapWrapper,
    Map,
    StringMapWrapper,
    List,
    ldModule,
    EventManager,
    ViewFactory,
    vcModule,
    viewModule,
    RenderViewHydrator;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      int = $__m.int;
      isPresent = $__m.isPresent;
      isBlank = $__m.isBlank;
      BaseException = $__m.BaseException;
    }, function($__m) {
      ListWrapper = $__m.ListWrapper;
      MapWrapper = $__m.MapWrapper;
      Map = $__m.Map;
      StringMapWrapper = $__m.StringMapWrapper;
      List = $__m.List;
    }, function($__m) {
      ldModule = $__m;
    }, function($__m) {
      EventManager = $__m.EventManager;
    }, function($__m) {
      ViewFactory = $__m.ViewFactory;
    }, function($__m) {
      vcModule = $__m;
    }, function($__m) {
      viewModule = $__m;
    }],
    execute: function() {
      RenderViewHydrator = $__export("RenderViewHydrator", (function() {
        var RenderViewHydrator = function RenderViewHydrator(eventManager, viewFactory) {
          assert.argumentTypes(eventManager, EventManager, viewFactory, ViewFactory);
          this._eventManager = eventManager;
          this._viewFactory = viewFactory;
        };
        return ($traceurRuntime.createClass)(RenderViewHydrator, {
          hydrateDynamicComponentView: function(hostView, boundElementIndex, componentView) {
            assert.argumentTypes(hostView, viewModule.RenderView, boundElementIndex, assert.type.number, componentView, viewModule.RenderView);
            this._viewFactory.setComponentView(hostView, boundElementIndex, componentView);
            var lightDom = hostView.lightDoms[boundElementIndex];
            this._viewHydrateRecurse(componentView, lightDom);
            if (isPresent(lightDom)) {
              lightDom.redistribute();
            }
          },
          dehydrateDynamicComponentView: function(parentView, boundElementIndex) {
            assert.argumentTypes(parentView, viewModule.RenderView, boundElementIndex, assert.type.number);
            throw new BaseException('Not supported yet');
          },
          hydrateInPlaceHostView: function(parentView, hostView) {
            assert.argumentTypes(parentView, viewModule.RenderView, hostView, viewModule.RenderView);
            if (isPresent(parentView)) {
              throw new BaseException('Not supported yet');
            }
            this._viewHydrateRecurse(hostView, null);
          },
          dehydrateInPlaceHostView: function(parentView, hostView) {
            assert.argumentTypes(parentView, viewModule.RenderView, hostView, viewModule.RenderView);
            if (isPresent(parentView)) {
              throw new BaseException('Not supported yet');
            }
            this._viewDehydrateRecurse(hostView);
          },
          hydrateViewInViewContainer: function(viewContainer, view) {
            assert.argumentTypes(viewContainer, vcModule.ViewContainer, view, viewModule.RenderView);
            this._viewHydrateRecurse(view, viewContainer.parentView.hostLightDom);
          },
          dehydrateViewInViewContainer: function(viewContainer, view) {
            assert.argumentTypes(viewContainer, vcModule.ViewContainer, view, viewModule.RenderView);
            this._viewDehydrateRecurse(view);
          },
          _viewHydrateRecurse: function(view, hostLightDom) {
            assert.argumentTypes(view, assert.type.any, hostLightDom, ldModule.LightDom);
            if (view.hydrated)
              throw new BaseException('The view is already hydrated.');
            view.hydrated = true;
            view.hostLightDom = hostLightDom;
            for (var i = 0; i < view.contentTags.length; i++) {
              var destLightDom = view.getDirectParentLightDom(i);
              var ct = view.contentTags[i];
              if (isPresent(ct)) {
                ct.hydrate(destLightDom);
              }
            }
            for (var i = 0; i < view.componentChildViews.length; i++) {
              var cv = view.componentChildViews[i];
              if (isPresent(cv)) {
                this._viewHydrateRecurse(cv, view.lightDoms[i]);
              }
            }
            for (var i = 0; i < view.lightDoms.length; ++i) {
              var lightDom = view.lightDoms[i];
              if (isPresent(lightDom)) {
                lightDom.redistribute();
              }
            }
            view.eventHandlerRemovers = ListWrapper.create();
            var binders = view.proto.elementBinders;
            for (var binderIdx = 0; binderIdx < binders.length; binderIdx++) {
              var binder = binders[binderIdx];
              if (isPresent(binder.globalEvents)) {
                for (var i = 0; i < binder.globalEvents.length; i++) {
                  var globalEvent = binder.globalEvents[i];
                  var remover = this._createGlobalEventListener(view, binderIdx, globalEvent.name, globalEvent.target, globalEvent.fullName);
                  ListWrapper.push(view.eventHandlerRemovers, remover);
                }
              }
            }
          },
          _createGlobalEventListener: function(view, elementIndex, eventName, eventTarget, fullName) {
            return assert.returnType((this._eventManager.addGlobalEventListener(eventTarget, eventName, (function(event) {
              view.dispatchEvent(elementIndex, fullName, event);
            }))), Function);
          },
          _viewDehydrateRecurse: function(view) {
            for (var i = 0; i < view.componentChildViews.length; i++) {
              var cv = view.componentChildViews[i];
              if (isPresent(cv)) {
                this._viewDehydrateRecurse(cv);
                if (view.proto.elementBinders[i].hasDynamicComponent()) {
                  vcModule.ViewContainer.removeViewNodes(cv);
                  view.lightDoms[i] = null;
                  view.componentChildViews[i] = null;
                }
              }
            }
            if (isPresent(view.viewContainers)) {
              for (var i = 0; i < view.viewContainers.length; i++) {
                var vc = view.viewContainers[i];
                if (isPresent(vc)) {
                  this._viewContainerDehydrateRecurse(vc);
                }
                var ct = view.contentTags[i];
                if (isPresent(ct)) {
                  ct.dehydrate();
                }
              }
            }
            for (var i = 0; i < view.eventHandlerRemovers.length; i++) {
              view.eventHandlerRemovers[i]();
            }
            view.hostLightDom = null;
            view.eventHandlerRemovers = null;
            view.setEventDispatcher(null);
            view.hydrated = false;
          },
          _viewContainerDehydrateRecurse: function(viewContainer) {
            for (var i = 0; i < viewContainer.views.length; i++) {
              this._viewDehydrateRecurse(viewContainer.views[i]);
            }
            viewContainer.clear();
          }
        }, {});
      }()));
      Object.defineProperty(RenderViewHydrator, "annotations", {get: function() {
        return [new Injectable()];
      }});
      Object.defineProperty(RenderViewHydrator, "parameters", {get: function() {
        return [[EventManager], [ViewFactory]];
      }});
      Object.defineProperty(RenderViewHydrator.prototype.hydrateDynamicComponentView, "parameters", {get: function() {
        return [[viewModule.RenderView], [assert.type.number], [viewModule.RenderView]];
      }});
      Object.defineProperty(RenderViewHydrator.prototype.dehydrateDynamicComponentView, "parameters", {get: function() {
        return [[viewModule.RenderView], [assert.type.number]];
      }});
      Object.defineProperty(RenderViewHydrator.prototype.hydrateInPlaceHostView, "parameters", {get: function() {
        return [[viewModule.RenderView], [viewModule.RenderView]];
      }});
      Object.defineProperty(RenderViewHydrator.prototype.dehydrateInPlaceHostView, "parameters", {get: function() {
        return [[viewModule.RenderView], [viewModule.RenderView]];
      }});
      Object.defineProperty(RenderViewHydrator.prototype.hydrateViewInViewContainer, "parameters", {get: function() {
        return [[vcModule.ViewContainer], [viewModule.RenderView]];
      }});
      Object.defineProperty(RenderViewHydrator.prototype.dehydrateViewInViewContainer, "parameters", {get: function() {
        return [[vcModule.ViewContainer], [viewModule.RenderView]];
      }});
      Object.defineProperty(RenderViewHydrator.prototype._viewHydrateRecurse, "parameters", {get: function() {
        return [[], [ldModule.LightDom]];
      }});
    }
  };
});

System.register("angular2/src/render/dom/view/property_setter_factory", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/src/dom/dom_adapter", "angular2/src/render/dom/util", "angular2/src/reflection/reflection"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/view/property_setter_factory";
  var assert,
    StringWrapper,
    RegExpWrapper,
    BaseException,
    isPresent,
    isBlank,
    isString,
    stringify,
    ListWrapper,
    StringMapWrapper,
    DOM,
    camelCaseToDashCase,
    dashCaseToCamelCase,
    reflector,
    STYLE_SEPARATOR,
    propertySettersCache,
    innerHTMLSetterCache,
    ATTRIBUTE_PREFIX,
    attributeSettersCache,
    CLASS_PREFIX,
    classSettersCache,
    STYLE_PREFIX,
    styleSettersCache;
  function setterFactory(property) {
    var setterFn,
      styleParts,
      styleSuffix;
    if (StringWrapper.startsWith(property, ATTRIBUTE_PREFIX)) {
      setterFn = attributeSetterFactory(StringWrapper.substring(property, ATTRIBUTE_PREFIX.length));
    } else if (StringWrapper.startsWith(property, CLASS_PREFIX)) {
      setterFn = classSetterFactory(StringWrapper.substring(property, CLASS_PREFIX.length));
    } else if (StringWrapper.startsWith(property, STYLE_PREFIX)) {
      styleParts = property.split(STYLE_SEPARATOR);
      styleSuffix = styleParts.length > 2 ? ListWrapper.get(styleParts, 2) : '';
      setterFn = styleSetterFactory(ListWrapper.get(styleParts, 1), styleSuffix);
    } else if (StringWrapper.equals(property, 'innerHtml')) {
      if (isBlank(innerHTMLSetterCache)) {
        innerHTMLSetterCache = (function(el, value) {
          return DOM.setInnerHTML(el, value);
        });
      }
      setterFn = innerHTMLSetterCache;
    } else {
      property = resolvePropertyName(property);
      setterFn = StringMapWrapper.get(propertySettersCache, property);
      if (isBlank(setterFn)) {
        var propertySetterFn = reflector.setter(property);
        setterFn = function(receiver, value) {
          if (DOM.hasProperty(receiver, property)) {
            return propertySetterFn(receiver, value);
          }
        };
        StringMapWrapper.set(propertySettersCache, property, setterFn);
      }
    }
    return assert.returnType((setterFn), Function);
  }
  function _isValidAttributeValue(attrName, value) {
    assert.argumentTypes(attrName, assert.type.string, value, assert.type.any);
    if (attrName == "role") {
      return assert.returnType((isString(value)), assert.type.boolean);
    } else {
      return assert.returnType((isPresent(value)), assert.type.boolean);
    }
  }
  function attributeSetterFactory(attrName) {
    assert.argumentTypes(attrName, assert.type.string);
    var setterFn = StringMapWrapper.get(attributeSettersCache, attrName);
    var dashCasedAttributeName;
    if (isBlank(setterFn)) {
      dashCasedAttributeName = camelCaseToDashCase(attrName);
      setterFn = function(element, value) {
        if (_isValidAttributeValue(dashCasedAttributeName, value)) {
          DOM.setAttribute(element, dashCasedAttributeName, stringify(value));
        } else {
          if (isPresent(value)) {
            throw new BaseException("Invalid " + dashCasedAttributeName + " attribute, only string values are allowed, got '" + stringify(value) + "'");
          }
          DOM.removeAttribute(element, dashCasedAttributeName);
        }
      };
      StringMapWrapper.set(attributeSettersCache, attrName, setterFn);
    }
    return assert.returnType((setterFn), Function);
  }
  function classSetterFactory(className) {
    assert.argumentTypes(className, assert.type.string);
    var setterFn = StringMapWrapper.get(classSettersCache, className);
    var dashCasedClassName;
    if (isBlank(setterFn)) {
      dashCasedClassName = camelCaseToDashCase(className);
      setterFn = function(element, value) {
        if (value) {
          DOM.addClass(element, dashCasedClassName);
        } else {
          DOM.removeClass(element, dashCasedClassName);
        }
      };
      StringMapWrapper.set(classSettersCache, className, setterFn);
    }
    return assert.returnType((setterFn), Function);
  }
  function styleSetterFactory(styleName, styleSuffix) {
    assert.argumentTypes(styleName, assert.type.string, styleSuffix, assert.type.string);
    var cacheKey = styleName + styleSuffix;
    var setterFn = StringMapWrapper.get(styleSettersCache, cacheKey);
    var dashCasedStyleName;
    if (isBlank(setterFn)) {
      dashCasedStyleName = camelCaseToDashCase(styleName);
      setterFn = function(element, value) {
        var valAsStr;
        if (isPresent(value)) {
          valAsStr = stringify(value);
          DOM.setStyle(element, dashCasedStyleName, valAsStr + styleSuffix);
        } else {
          DOM.removeStyle(element, dashCasedStyleName);
        }
      };
      StringMapWrapper.set(styleSettersCache, cacheKey, setterFn);
    }
    return assert.returnType((setterFn), Function);
  }
  function resolvePropertyName(attrName) {
    assert.argumentTypes(attrName, assert.type.string);
    var mappedPropName = StringMapWrapper.get(DOM.attrToPropMap, attrName);
    return assert.returnType((isPresent(mappedPropName) ? mappedPropName : attrName), assert.type.string);
  }
  $__export("setterFactory", setterFactory);
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      StringWrapper = $__m.StringWrapper;
      RegExpWrapper = $__m.RegExpWrapper;
      BaseException = $__m.BaseException;
      isPresent = $__m.isPresent;
      isBlank = $__m.isBlank;
      isString = $__m.isString;
      stringify = $__m.stringify;
    }, function($__m) {
      ListWrapper = $__m.ListWrapper;
      StringMapWrapper = $__m.StringMapWrapper;
    }, function($__m) {
      DOM = $__m.DOM;
    }, function($__m) {
      camelCaseToDashCase = $__m.camelCaseToDashCase;
      dashCaseToCamelCase = $__m.dashCaseToCamelCase;
    }, function($__m) {
      reflector = $__m.reflector;
    }],
    execute: function() {
      STYLE_SEPARATOR = '.';
      propertySettersCache = StringMapWrapper.create();
      Object.defineProperty(setterFactory, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      ATTRIBUTE_PREFIX = 'attr.';
      attributeSettersCache = StringMapWrapper.create();
      Object.defineProperty(_isValidAttributeValue, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.any]];
      }});
      Object.defineProperty(attributeSetterFactory, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      CLASS_PREFIX = 'class.';
      classSettersCache = StringMapWrapper.create();
      Object.defineProperty(classSetterFactory, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      STYLE_PREFIX = 'style.';
      styleSettersCache = StringMapWrapper.create();
      Object.defineProperty(styleSetterFactory, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(resolvePropertyName, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
    }
  };
});

System.register("angular2/src/render/dom/compiler/compile_step", ["rtts_assert/rtts_assert", "angular2/src/render/dom/compiler/compile_element", "angular2/src/render/dom/compiler/compile_control"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/compiler/compile_step";
  var assert,
    CompileElement,
    compileControlModule,
    CompileStep;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      CompileElement = $__m.CompileElement;
    }, function($__m) {
      compileControlModule = $__m;
    }],
    execute: function() {
      CompileStep = $__export("CompileStep", (function() {
        var CompileStep = function CompileStep() {
          ;
        };
        return ($traceurRuntime.createClass)(CompileStep, {process: function(parent, current, control) {
          assert.argumentTypes(parent, CompileElement, current, CompileElement, control, compileControlModule.CompileControl);
        }}, {});
      }()));
      Object.defineProperty(CompileStep.prototype.process, "parameters", {get: function() {
        return [[CompileElement], [CompileElement], [compileControlModule.CompileControl]];
      }});
    }
  };
});

System.register("angular2/src/services/xhr", ["rtts_assert/rtts_assert", "angular2/src/facade/async"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/services/xhr";
  var assert,
    Promise,
    XHR;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Promise = $__m.Promise;
    }],
    execute: function() {
      XHR = $__export("XHR", (function() {
        var XHR = function XHR() {
          ;
        };
        return ($traceurRuntime.createClass)(XHR, {get: function(url) {
          assert.argumentTypes(url, assert.type.string);
          return assert.returnType((null), assert.genericType(Promise, assert.type.string));
        }}, {});
      }()));
      Object.defineProperty(XHR.prototype.get, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
    }
  };
});

System.register("angular2/src/services/url_resolver", ["rtts_assert/rtts_assert", "angular2/di", "angular2/src/facade/lang", "angular2/src/dom/dom_adapter"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/services/url_resolver";
  var assert,
    Injectable,
    isPresent,
    isBlank,
    RegExpWrapper,
    BaseException,
    DOM,
    UrlResolver,
    _schemeRe;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      isPresent = $__m.isPresent;
      isBlank = $__m.isBlank;
      RegExpWrapper = $__m.RegExpWrapper;
      BaseException = $__m.BaseException;
    }, function($__m) {
      DOM = $__m.DOM;
    }],
    execute: function() {
      UrlResolver = $__export("UrlResolver", (function() {
        var UrlResolver = function UrlResolver() {
          if (isBlank(UrlResolver.a)) {
            UrlResolver.a = DOM.createElement('a');
          }
        };
        return ($traceurRuntime.createClass)(UrlResolver, {resolve: function(baseUrl, url) {
          assert.argumentTypes(baseUrl, assert.type.string, url, assert.type.string);
          if (isBlank(baseUrl)) {
            DOM.resolveAndSetHref(UrlResolver.a, url, null);
            return assert.returnType((DOM.getHref(UrlResolver.a)), assert.type.string);
          }
          if (isBlank(url) || url == '')
            return assert.returnType((baseUrl), assert.type.string);
          if (url[0] == '/') {
            throw new BaseException(("Could not resolve the url " + url + " from " + baseUrl));
          }
          var m = RegExpWrapper.firstMatch(_schemeRe, url);
          if (isPresent(m[1])) {
            return assert.returnType((url), assert.type.string);
          }
          DOM.resolveAndSetHref(UrlResolver.a, baseUrl, url);
          return assert.returnType((DOM.getHref(UrlResolver.a)), assert.type.string);
        }}, {});
      }()));
      Object.defineProperty(UrlResolver, "annotations", {get: function() {
        return [new Injectable()];
      }});
      Object.defineProperty(UrlResolver.prototype.resolve, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      _schemeRe = RegExpWrapper.create('^([^:/?#]+:)?');
    }
  };
});

System.register("angular2/src/render/dom/compiler/property_binding_parser", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/change_detection", "angular2/src/render/dom/compiler/compile_step", "angular2/src/render/dom/compiler/compile_element", "angular2/src/render/dom/compiler/compile_control", "angular2/src/render/dom/util"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/compiler/property_binding_parser";
  var assert,
    isPresent,
    RegExpWrapper,
    MapWrapper,
    Parser,
    CompileStep,
    CompileElement,
    CompileControl,
    dashCaseToCamelCase,
    BIND_NAME_REGEXP,
    PropertyBindingParser;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isPresent = $__m.isPresent;
      RegExpWrapper = $__m.RegExpWrapper;
    }, function($__m) {
      MapWrapper = $__m.MapWrapper;
    }, function($__m) {
      Parser = $__m.Parser;
    }, function($__m) {
      CompileStep = $__m.CompileStep;
    }, function($__m) {
      CompileElement = $__m.CompileElement;
    }, function($__m) {
      CompileControl = $__m.CompileControl;
    }, function($__m) {
      dashCaseToCamelCase = $__m.dashCaseToCamelCase;
    }],
    execute: function() {
      BIND_NAME_REGEXP = RegExpWrapper.create('^(?:(?:(?:(bind-)|(var-|#)|(on-))(.+))|\\[([^\\]]+)\\]|\\(([^\\)]+)\\))$');
      PropertyBindingParser = $__export("PropertyBindingParser", (function($__super) {
        var PropertyBindingParser = function PropertyBindingParser(parser) {
          assert.argumentTypes(parser, Parser);
          $traceurRuntime.superConstructor(PropertyBindingParser).call(this);
          this._parser = parser;
        };
        return ($traceurRuntime.createClass)(PropertyBindingParser, {
          process: function(parent, current, control) {
            var $__0 = this;
            assert.argumentTypes(parent, CompileElement, current, CompileElement, control, CompileControl);
            var attrs = current.attrs();
            var newAttrs = MapWrapper.create();
            MapWrapper.forEach(attrs, (function(attrValue, attrName) {
              var bindParts = RegExpWrapper.firstMatch(BIND_NAME_REGEXP, attrName);
              if (isPresent(bindParts)) {
                if (isPresent(bindParts[1])) {
                  $__0._bindProperty(bindParts[4], attrValue, current, newAttrs);
                } else if (isPresent(bindParts[2])) {
                  var identifier = bindParts[4];
                  var value = attrValue == '' ? '\$implicit' : attrValue;
                  $__0._bindVariable(identifier, value, current, newAttrs);
                } else if (isPresent(bindParts[3])) {
                  $__0._bindEvent(bindParts[4], attrValue, current, newAttrs);
                } else if (isPresent(bindParts[5])) {
                  $__0._bindProperty(bindParts[5], attrValue, current, newAttrs);
                } else if (isPresent(bindParts[6])) {
                  $__0._bindEvent(bindParts[6], attrValue, current, newAttrs);
                }
              } else {
                var expr = $__0._parser.parseInterpolation(attrValue, current.elementDescription);
                if (isPresent(expr)) {
                  $__0._bindPropertyAst(attrName, expr, current, newAttrs);
                }
              }
            }));
            MapWrapper.forEach(newAttrs, (function(attrValue, attrName) {
              MapWrapper.set(attrs, attrName, attrValue);
            }));
          },
          _bindVariable: function(identifier, value, current, newAttrs) {
            assert.argumentTypes(identifier, assert.type.any, value, assert.type.any, current, CompileElement, newAttrs, assert.type.any);
            current.bindElement().bindVariable(dashCaseToCamelCase(identifier), value);
            MapWrapper.set(newAttrs, identifier, value);
          },
          _bindProperty: function(name, expression, current, newAttrs) {
            assert.argumentTypes(name, assert.type.any, expression, assert.type.any, current, CompileElement, newAttrs, assert.type.any);
            this._bindPropertyAst(name, this._parser.parseBinding(expression, current.elementDescription), current, newAttrs);
          },
          _bindPropertyAst: function(name, ast, current, newAttrs) {
            assert.argumentTypes(name, assert.type.any, ast, assert.type.any, current, CompileElement, newAttrs, assert.type.any);
            var binder = current.bindElement();
            var camelCaseName = dashCaseToCamelCase(name);
            binder.bindProperty(camelCaseName, ast);
            MapWrapper.set(newAttrs, name, ast.source);
          },
          _bindEvent: function(name, expression, current, newAttrs) {
            assert.argumentTypes(name, assert.type.any, expression, assert.type.any, current, CompileElement, newAttrs, assert.type.any);
            current.bindElement().bindEvent(dashCaseToCamelCase(name), this._parser.parseAction(expression, current.elementDescription));
          }
        }, {}, $__super);
      }(CompileStep)));
      Object.defineProperty(PropertyBindingParser, "parameters", {get: function() {
        return [[Parser]];
      }});
      Object.defineProperty(PropertyBindingParser.prototype.process, "parameters", {get: function() {
        return [[CompileElement], [CompileElement], [CompileControl]];
      }});
      Object.defineProperty(PropertyBindingParser.prototype._bindVariable, "parameters", {get: function() {
        return [[], [], [CompileElement], []];
      }});
      Object.defineProperty(PropertyBindingParser.prototype._bindProperty, "parameters", {get: function() {
        return [[], [], [CompileElement], []];
      }});
      Object.defineProperty(PropertyBindingParser.prototype._bindPropertyAst, "parameters", {get: function() {
        return [[], [], [CompileElement], []];
      }});
      Object.defineProperty(PropertyBindingParser.prototype._bindEvent, "parameters", {get: function() {
        return [[], [], [CompileElement], []];
      }});
    }
  };
});

System.register("angular2/src/render/dom/compiler/text_interpolation_parser", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/dom/dom_adapter", "angular2/change_detection", "angular2/src/render/dom/compiler/compile_step", "angular2/src/render/dom/compiler/compile_element", "angular2/src/render/dom/compiler/compile_control"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/compiler/text_interpolation_parser";
  var assert,
    RegExpWrapper,
    StringWrapper,
    isPresent,
    DOM,
    Parser,
    CompileStep,
    CompileElement,
    CompileControl,
    TextInterpolationParser;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      RegExpWrapper = $__m.RegExpWrapper;
      StringWrapper = $__m.StringWrapper;
      isPresent = $__m.isPresent;
    }, function($__m) {
      DOM = $__m.DOM;
    }, function($__m) {
      Parser = $__m.Parser;
    }, function($__m) {
      CompileStep = $__m.CompileStep;
    }, function($__m) {
      CompileElement = $__m.CompileElement;
    }, function($__m) {
      CompileControl = $__m.CompileControl;
    }],
    execute: function() {
      TextInterpolationParser = $__export("TextInterpolationParser", (function($__super) {
        var TextInterpolationParser = function TextInterpolationParser(parser) {
          assert.argumentTypes(parser, Parser);
          $traceurRuntime.superConstructor(TextInterpolationParser).call(this);
          this._parser = parser;
        };
        return ($traceurRuntime.createClass)(TextInterpolationParser, {process: function(parent, current, control) {
          assert.argumentTypes(parent, CompileElement, current, CompileElement, control, CompileControl);
          if (!current.compileChildren) {
            return ;
          }
          var element = current.element;
          var childNodes = DOM.childNodes(DOM.templateAwareRoot(element));
          for (var i = 0; i < childNodes.length; i++) {
            var node = childNodes[i];
            if (DOM.isTextNode(node)) {
              var text = DOM.nodeValue(node);
              var expr = this._parser.parseInterpolation(text, current.elementDescription);
              if (isPresent(expr)) {
                DOM.setText(node, ' ');
                current.bindElement().bindText(i, expr);
              }
            }
          }
        }}, {}, $__super);
      }(CompileStep)));
      Object.defineProperty(TextInterpolationParser, "parameters", {get: function() {
        return [[Parser]];
      }});
      Object.defineProperty(TextInterpolationParser.prototype.process, "parameters", {get: function() {
        return [[CompileElement], [CompileElement], [CompileControl]];
      }});
    }
  };
});

System.register("angular2/src/render/dom/compiler/selector", ["rtts_assert/rtts_assert", "angular2/src/facade/collection", "angular2/src/facade/lang"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/compiler/selector";
  var assert,
    List,
    Map,
    ListWrapper,
    MapWrapper,
    isPresent,
    isBlank,
    RegExpWrapper,
    RegExpMatcherWrapper,
    StringWrapper,
    BaseException,
    _EMPTY_ATTR_VALUE,
    _SELECTOR_REGEXP,
    CssSelector,
    SelectorMatcher,
    SelectorListContext,
    SelectorContext;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      List = $__m.List;
      Map = $__m.Map;
      ListWrapper = $__m.ListWrapper;
      MapWrapper = $__m.MapWrapper;
    }, function($__m) {
      isPresent = $__m.isPresent;
      isBlank = $__m.isBlank;
      RegExpWrapper = $__m.RegExpWrapper;
      RegExpMatcherWrapper = $__m.RegExpMatcherWrapper;
      StringWrapper = $__m.StringWrapper;
      BaseException = $__m.BaseException;
    }],
    execute: function() {
      _EMPTY_ATTR_VALUE = '';
      _SELECTOR_REGEXP = RegExpWrapper.create('(\\:not\\()|' + '([-\\w]+)|' + '(?:\\.([-\\w]+))|' + '(?:\\[([-\\w*]+)(?:=([^\\]]*))?\\])|' + '(?:\\))|' + '(\\s*,\\s*)');
      CssSelector = $__export("CssSelector", (function() {
        var CssSelector = function CssSelector() {
          this.element = null;
          this.classNames = ListWrapper.create();
          this.attrs = ListWrapper.create();
          this.notSelector = null;
        };
        return ($traceurRuntime.createClass)(CssSelector, {
          setElement: function() {
            var element = arguments[0] !== (void 0) ? arguments[0] : null;
            assert.argumentTypes(element, assert.type.string);
            if (isPresent(element)) {
              element = element.toLowerCase();
            }
            this.element = element;
          },
          addAttribute: function(name) {
            var value = arguments[1] !== (void 0) ? arguments[1] : _EMPTY_ATTR_VALUE;
            assert.argumentTypes(name, assert.type.string, value, assert.type.string);
            ListWrapper.push(this.attrs, name.toLowerCase());
            if (isPresent(value)) {
              value = value.toLowerCase();
            } else {
              value = _EMPTY_ATTR_VALUE;
            }
            ListWrapper.push(this.attrs, value);
          },
          addClassName: function(name) {
            assert.argumentTypes(name, assert.type.string);
            ListWrapper.push(this.classNames, name.toLowerCase());
          },
          toString: function() {
            var res = '';
            if (isPresent(this.element)) {
              res += this.element;
            }
            if (isPresent(this.classNames)) {
              for (var i = 0; i < this.classNames.length; i++) {
                res += '.' + this.classNames[i];
              }
            }
            if (isPresent(this.attrs)) {
              for (var i = 0; i < this.attrs.length; ) {
                var attrName = this.attrs[i++];
                var attrValue = this.attrs[i++];
                res += '[' + attrName;
                if (attrValue.length > 0) {
                  res += '=' + attrValue;
                }
                res += ']';
              }
            }
            if (isPresent(this.notSelector)) {
              res += ":not(" + this.notSelector.toString() + ")";
            }
            return assert.returnType((res), assert.type.string);
          }
        }, {parse: function(selector) {
          assert.argumentTypes(selector, assert.type.string);
          var results = ListWrapper.create();
          var _addResult = (function(res, cssSel) {
            if (isPresent(cssSel.notSelector) && isBlank(cssSel.element) && ListWrapper.isEmpty(cssSel.classNames) && ListWrapper.isEmpty(cssSel.attrs)) {
              cssSel.element = "*";
            }
            ListWrapper.push(res, cssSel);
          });
          var cssSelector = new CssSelector();
          var matcher = RegExpWrapper.matcher(_SELECTOR_REGEXP, selector);
          var match;
          var current = cssSelector;
          while (isPresent(match = RegExpMatcherWrapper.next(matcher))) {
            if (isPresent(match[1])) {
              if (isPresent(cssSelector.notSelector)) {
                throw new BaseException('Nesting :not is not allowed in a selector');
              }
              current.notSelector = new CssSelector();
              current = current.notSelector;
            }
            if (isPresent(match[2])) {
              current.setElement(match[2]);
            }
            if (isPresent(match[3])) {
              current.addClassName(match[3]);
            }
            if (isPresent(match[4])) {
              current.addAttribute(match[4], match[5]);
            }
            if (isPresent(match[6])) {
              _addResult(results, cssSelector);
              cssSelector = current = new CssSelector();
            }
          }
          _addResult(results, cssSelector);
          return assert.returnType((results), assert.genericType(List, CssSelector));
        }});
      }()));
      Object.defineProperty(CssSelector.parse, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(CssSelector.prototype.setElement, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(CssSelector.prototype.addAttribute, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(CssSelector.prototype.addClassName, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      SelectorMatcher = $__export("SelectorMatcher", (function() {
        var SelectorMatcher = function SelectorMatcher() {
          this._elementMap = MapWrapper.create();
          this._elementPartialMap = MapWrapper.create();
          this._classMap = MapWrapper.create();
          this._classPartialMap = MapWrapper.create();
          this._attrValueMap = MapWrapper.create();
          this._attrValuePartialMap = MapWrapper.create();
          this._listContexts = ListWrapper.create();
        };
        return ($traceurRuntime.createClass)(SelectorMatcher, {
          addSelectables: function(cssSelectors, callbackCtxt) {
            assert.argumentTypes(cssSelectors, assert.genericType(List, CssSelector), callbackCtxt, assert.type.any);
            var listContext = null;
            if (cssSelectors.length > 1) {
              listContext = new SelectorListContext(cssSelectors);
              ListWrapper.push(this._listContexts, listContext);
            }
            for (var i = 0; i < cssSelectors.length; i++) {
              this.addSelectable(cssSelectors[i], callbackCtxt, listContext);
            }
          },
          addSelectable: function(cssSelector, callbackCtxt, listContext) {
            assert.argumentTypes(cssSelector, assert.type.any, callbackCtxt, assert.type.any, listContext, SelectorListContext);
            var matcher = this;
            var element = cssSelector.element;
            var classNames = cssSelector.classNames;
            var attrs = cssSelector.attrs;
            var selectable = new SelectorContext(cssSelector, callbackCtxt, listContext);
            if (isPresent(element)) {
              var isTerminal = attrs.length === 0 && classNames.length === 0;
              if (isTerminal) {
                this._addTerminal(matcher._elementMap, element, selectable);
              } else {
                matcher = this._addPartial(matcher._elementPartialMap, element);
              }
            }
            if (isPresent(classNames)) {
              for (var index = 0; index < classNames.length; index++) {
                var isTerminal = attrs.length === 0 && index === classNames.length - 1;
                var className = classNames[index];
                if (isTerminal) {
                  this._addTerminal(matcher._classMap, className, selectable);
                } else {
                  matcher = this._addPartial(matcher._classPartialMap, className);
                }
              }
            }
            if (isPresent(attrs)) {
              for (var index = 0; index < attrs.length; ) {
                var isTerminal = index === attrs.length - 2;
                var attrName = attrs[index++];
                var attrValue = attrs[index++];
                var map = isTerminal ? matcher._attrValueMap : matcher._attrValuePartialMap;
                var valuesMap = MapWrapper.get(map, attrName);
                if (isBlank(valuesMap)) {
                  valuesMap = MapWrapper.create();
                  MapWrapper.set(map, attrName, valuesMap);
                }
                if (isTerminal) {
                  this._addTerminal(valuesMap, attrValue, selectable);
                } else {
                  matcher = this._addPartial(valuesMap, attrValue);
                }
              }
            }
          },
          _addTerminal: function(map, name, selectable) {
            assert.argumentTypes(map, assert.genericType(Map, assert.type.string, assert.type.string), name, assert.type.string, selectable, assert.type.any);
            var terminalList = MapWrapper.get(map, name);
            if (isBlank(terminalList)) {
              terminalList = ListWrapper.create();
              MapWrapper.set(map, name, terminalList);
            }
            ListWrapper.push(terminalList, selectable);
          },
          _addPartial: function(map, name) {
            assert.argumentTypes(map, assert.genericType(Map, assert.type.string, assert.type.string), name, assert.type.string);
            var matcher = MapWrapper.get(map, name);
            if (isBlank(matcher)) {
              matcher = new SelectorMatcher();
              MapWrapper.set(map, name, matcher);
            }
            return matcher;
          },
          match: function(cssSelector, matchedCallback) {
            assert.argumentTypes(cssSelector, CssSelector, matchedCallback, Function);
            var result = false;
            var element = cssSelector.element;
            var classNames = cssSelector.classNames;
            var attrs = cssSelector.attrs;
            for (var i = 0; i < this._listContexts.length; i++) {
              this._listContexts[i].alreadyMatched = false;
            }
            result = this._matchTerminal(this._elementMap, element, cssSelector, matchedCallback) || result;
            result = this._matchPartial(this._elementPartialMap, element, cssSelector, matchedCallback) || result;
            if (isPresent(classNames)) {
              for (var index = 0; index < classNames.length; index++) {
                var className = classNames[index];
                result = this._matchTerminal(this._classMap, className, cssSelector, matchedCallback) || result;
                result = this._matchPartial(this._classPartialMap, className, cssSelector, matchedCallback) || result;
              }
            }
            if (isPresent(attrs)) {
              for (var index = 0; index < attrs.length; ) {
                var attrName = attrs[index++];
                var attrValue = attrs[index++];
                var valuesMap = MapWrapper.get(this._attrValueMap, attrName);
                if (!StringWrapper.equals(attrValue, _EMPTY_ATTR_VALUE)) {
                  result = this._matchTerminal(valuesMap, _EMPTY_ATTR_VALUE, cssSelector, matchedCallback) || result;
                }
                result = this._matchTerminal(valuesMap, attrValue, cssSelector, matchedCallback) || result;
                valuesMap = MapWrapper.get(this._attrValuePartialMap, attrName);
                result = this._matchPartial(valuesMap, attrValue, cssSelector, matchedCallback) || result;
              }
            }
            return assert.returnType((result), assert.type.boolean);
          },
          _matchTerminal: function() {
            var map = arguments[0] !== (void 0) ? arguments[0] : null;
            var name = arguments[1];
            var cssSelector = arguments[2];
            var matchedCallback = arguments[3];
            assert.argumentTypes(map, assert.genericType(Map, assert.type.string, assert.type.string), name, assert.type.any, cssSelector, assert.type.any, matchedCallback, assert.type.any);
            if (isBlank(map) || isBlank(name)) {
              return assert.returnType((false), assert.type.boolean);
            }
            var selectables = MapWrapper.get(map, name);
            var starSelectables = MapWrapper.get(map, "*");
            if (isPresent(starSelectables)) {
              selectables = ListWrapper.concat(selectables, starSelectables);
            }
            if (isBlank(selectables)) {
              return assert.returnType((false), assert.type.boolean);
            }
            var selectable;
            var result = false;
            for (var index = 0; index < selectables.length; index++) {
              selectable = selectables[index];
              result = selectable.finalize(cssSelector, matchedCallback) || result;
            }
            return assert.returnType((result), assert.type.boolean);
          },
          _matchPartial: function() {
            var map = arguments[0] !== (void 0) ? arguments[0] : null;
            var name = arguments[1];
            var cssSelector = arguments[2];
            var matchedCallback = arguments[3];
            assert.argumentTypes(map, assert.genericType(Map, assert.type.string, assert.type.string), name, assert.type.any, cssSelector, assert.type.any, matchedCallback, assert.type.any);
            if (isBlank(map) || isBlank(name)) {
              return assert.returnType((false), assert.type.boolean);
            }
            var nestedSelector = MapWrapper.get(map, name);
            if (isBlank(nestedSelector)) {
              return assert.returnType((false), assert.type.boolean);
            }
            return assert.returnType((nestedSelector.match(cssSelector, matchedCallback)), assert.type.boolean);
          }
        }, {});
      }()));
      Object.defineProperty(SelectorMatcher.prototype.addSelectables, "parameters", {get: function() {
        return [[assert.genericType(List, CssSelector)], []];
      }});
      Object.defineProperty(SelectorMatcher.prototype.addSelectable, "parameters", {get: function() {
        return [[], [], [SelectorListContext]];
      }});
      Object.defineProperty(SelectorMatcher.prototype._addTerminal, "parameters", {get: function() {
        return [[assert.genericType(Map, assert.type.string, assert.type.string)], [assert.type.string], []];
      }});
      Object.defineProperty(SelectorMatcher.prototype._addPartial, "parameters", {get: function() {
        return [[assert.genericType(Map, assert.type.string, assert.type.string)], [assert.type.string]];
      }});
      Object.defineProperty(SelectorMatcher.prototype.match, "parameters", {get: function() {
        return [[CssSelector], [Function]];
      }});
      Object.defineProperty(SelectorMatcher.prototype._matchTerminal, "parameters", {get: function() {
        return [[assert.genericType(Map, assert.type.string, assert.type.string)], [], [], []];
      }});
      Object.defineProperty(SelectorMatcher.prototype._matchPartial, "parameters", {get: function() {
        return [[assert.genericType(Map, assert.type.string, assert.type.string)], [], [], []];
      }});
      SelectorListContext = (function() {
        var SelectorListContext = function SelectorListContext(selectors) {
          assert.argumentTypes(selectors, assert.genericType(List, CssSelector));
          this.selectors = selectors;
          this.alreadyMatched = false;
        };
        return ($traceurRuntime.createClass)(SelectorListContext, {}, {});
      }());
      Object.defineProperty(SelectorListContext, "parameters", {get: function() {
        return [[assert.genericType(List, CssSelector)]];
      }});
      SelectorContext = (function() {
        var SelectorContext = function SelectorContext(selector, cbContext, listContext) {
          assert.argumentTypes(selector, CssSelector, cbContext, assert.type.any, listContext, SelectorListContext);
          this.selector = selector;
          this.notSelector = selector.notSelector;
          this.cbContext = cbContext;
          this.listContext = listContext;
        };
        return ($traceurRuntime.createClass)(SelectorContext, {finalize: function(cssSelector, callback) {
          assert.argumentTypes(cssSelector, CssSelector, callback, assert.type.any);
          var result = true;
          if (isPresent(this.notSelector) && (isBlank(this.listContext) || !this.listContext.alreadyMatched)) {
            var notMatcher = new SelectorMatcher();
            notMatcher.addSelectable(this.notSelector, null, null);
            result = !notMatcher.match(cssSelector, null);
          }
          if (result && isPresent(callback) && (isBlank(this.listContext) || !this.listContext.alreadyMatched)) {
            if (isPresent(this.listContext)) {
              this.listContext.alreadyMatched = true;
            }
            callback(this.selector, this.cbContext);
          }
          return result;
        }}, {});
      }());
      Object.defineProperty(SelectorContext, "parameters", {get: function() {
        return [[CssSelector], [], [SelectorListContext]];
      }});
      Object.defineProperty(SelectorContext.prototype.finalize, "parameters", {get: function() {
        return [[CssSelector], []];
      }});
    }
  };
});

System.register("angular2/src/render/dom/compiler/view_splitter", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/dom/dom_adapter", "angular2/src/facade/collection", "angular2/change_detection", "angular2/src/render/dom/compiler/compile_step", "angular2/src/render/dom/compiler/compile_element", "angular2/src/render/dom/compiler/compile_control", "angular2/src/render/dom/util"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/compiler/view_splitter";
  var assert,
    isBlank,
    isPresent,
    BaseException,
    StringWrapper,
    DOM,
    MapWrapper,
    ListWrapper,
    Parser,
    CompileStep,
    CompileElement,
    CompileControl,
    dashCaseToCamelCase,
    ViewSplitter;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isBlank = $__m.isBlank;
      isPresent = $__m.isPresent;
      BaseException = $__m.BaseException;
      StringWrapper = $__m.StringWrapper;
    }, function($__m) {
      DOM = $__m.DOM;
    }, function($__m) {
      MapWrapper = $__m.MapWrapper;
      ListWrapper = $__m.ListWrapper;
    }, function($__m) {
      Parser = $__m.Parser;
    }, function($__m) {
      CompileStep = $__m.CompileStep;
    }, function($__m) {
      CompileElement = $__m.CompileElement;
    }, function($__m) {
      CompileControl = $__m.CompileControl;
    }, function($__m) {
      dashCaseToCamelCase = $__m.dashCaseToCamelCase;
    }],
    execute: function() {
      ViewSplitter = $__export("ViewSplitter", (function($__super) {
        var ViewSplitter = function ViewSplitter(parser) {
          assert.argumentTypes(parser, Parser);
          $traceurRuntime.superConstructor(ViewSplitter).call(this);
          this._parser = parser;
        };
        return ($traceurRuntime.createClass)(ViewSplitter, {
          process: function(parent, current, control) {
            assert.argumentTypes(parent, CompileElement, current, CompileElement, control, CompileControl);
            var attrs = current.attrs();
            var templateBindings = MapWrapper.get(attrs, 'template');
            var hasTemplateBinding = isPresent(templateBindings);
            MapWrapper.forEach(attrs, (function(attrValue, attrName) {
              if (StringWrapper.startsWith(attrName, '*')) {
                var key = StringWrapper.substring(attrName, 1);
                if (hasTemplateBinding) {
                  throw new BaseException("Only one template directive per element is allowed: " + (templateBindings + " and " + key + " cannot be used simultaneously ") + ("in " + current.elementDescription));
                } else {
                  templateBindings = (attrValue.length == 0) ? key : key + ' ' + attrValue;
                  hasTemplateBinding = true;
                }
              }
            }));
            if (isPresent(parent)) {
              if (DOM.isTemplateElement(current.element)) {
                if (!current.isViewRoot) {
                  var viewRoot = new CompileElement(DOM.createTemplate(''));
                  viewRoot.inheritedProtoView = current.bindElement().bindNestedProtoView(viewRoot.element);
                  viewRoot.elementDescription = current.elementDescription;
                  viewRoot.isViewRoot = true;
                  this._moveChildNodes(DOM.content(current.element), DOM.content(viewRoot.element));
                  control.addChild(viewRoot);
                }
              }
              if (hasTemplateBinding) {
                var newParent = new CompileElement(DOM.createTemplate(''));
                newParent.inheritedProtoView = current.inheritedProtoView;
                newParent.inheritedElementBinder = current.inheritedElementBinder;
                newParent.distanceToInheritedBinder = current.distanceToInheritedBinder;
                newParent.elementDescription = current.elementDescription;
                current.inheritedProtoView = newParent.bindElement().bindNestedProtoView(current.element);
                current.inheritedElementBinder = null;
                current.distanceToInheritedBinder = 0;
                current.isViewRoot = true;
                this._parseTemplateBindings(templateBindings, newParent);
                this._addParentElement(current.element, newParent.element);
                control.addParent(newParent);
                DOM.remove(current.element);
              }
            }
          },
          _moveChildNodes: function(source, target) {
            var next = DOM.firstChild(source);
            while (isPresent(next)) {
              DOM.appendChild(target, next);
              next = DOM.firstChild(source);
            }
          },
          _addParentElement: function(currentElement, newParentElement) {
            DOM.insertBefore(currentElement, newParentElement);
            DOM.appendChild(newParentElement, currentElement);
          },
          _parseTemplateBindings: function(templateBindings, compileElement) {
            assert.argumentTypes(templateBindings, assert.type.string, compileElement, CompileElement);
            var bindings = this._parser.parseTemplateBindings(templateBindings, compileElement.elementDescription);
            for (var i = 0; i < bindings.length; i++) {
              var binding = bindings[i];
              if (binding.keyIsVar) {
                compileElement.bindElement().bindVariable(dashCaseToCamelCase(binding.key), binding.name);
                MapWrapper.set(compileElement.attrs(), binding.key, binding.name);
              } else if (isPresent(binding.expression)) {
                compileElement.bindElement().bindProperty(dashCaseToCamelCase(binding.key), binding.expression);
                MapWrapper.set(compileElement.attrs(), binding.key, binding.expression.source);
              } else {
                DOM.setAttribute(compileElement.element, binding.key, '');
              }
            }
          }
        }, {}, $__super);
      }(CompileStep)));
      Object.defineProperty(ViewSplitter, "parameters", {get: function() {
        return [[Parser]];
      }});
      Object.defineProperty(ViewSplitter.prototype.process, "parameters", {get: function() {
        return [[CompileElement], [CompileElement], [CompileControl]];
      }});
      Object.defineProperty(ViewSplitter.prototype._parseTemplateBindings, "parameters", {get: function() {
        return [[assert.type.string], [CompileElement]];
      }});
    }
  };
});

System.register("angular2/src/render/dom/shadow_dom/shadow_dom_compile_step", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/src/facade/async", "angular2/src/dom/dom_adapter", "angular2/src/render/dom/compiler/compile_step", "angular2/src/render/dom/compiler/compile_element", "angular2/src/render/dom/compiler/compile_control", "angular2/src/render/api", "angular2/src/render/dom/shadow_dom/shadow_dom_strategy"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/shadow_dom/shadow_dom_compile_step";
  var assert,
    isBlank,
    isPresent,
    assertionsEnabled,
    MapWrapper,
    List,
    ListWrapper,
    Promise,
    PromiseWrapper,
    DOM,
    CompileStep,
    CompileElement,
    CompileControl,
    ViewDefinition,
    ShadowDomStrategy,
    ShadowDomCompileStep;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      isBlank = $__m.isBlank;
      isPresent = $__m.isPresent;
      assertionsEnabled = $__m.assertionsEnabled;
    }, function($__m) {
      MapWrapper = $__m.MapWrapper;
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
    }, function($__m) {
      Promise = $__m.Promise;
      PromiseWrapper = $__m.PromiseWrapper;
    }, function($__m) {
      DOM = $__m.DOM;
    }, function($__m) {
      CompileStep = $__m.CompileStep;
    }, function($__m) {
      CompileElement = $__m.CompileElement;
    }, function($__m) {
      CompileControl = $__m.CompileControl;
    }, function($__m) {
      ViewDefinition = $__m.ViewDefinition;
    }, function($__m) {
      ShadowDomStrategy = $__m.ShadowDomStrategy;
    }],
    execute: function() {
      ShadowDomCompileStep = $__export("ShadowDomCompileStep", (function($__super) {
        var ShadowDomCompileStep = function ShadowDomCompileStep(shadowDomStrategy, template, subTaskPromises) {
          assert.argumentTypes(shadowDomStrategy, ShadowDomStrategy, template, ViewDefinition, subTaskPromises, assert.genericType(List, Promise));
          $traceurRuntime.superConstructor(ShadowDomCompileStep).call(this);
          this._shadowDomStrategy = shadowDomStrategy;
          this._template = template;
          this._subTaskPromises = subTaskPromises;
        };
        return ($traceurRuntime.createClass)(ShadowDomCompileStep, {
          process: function(parent, current, control) {
            assert.argumentTypes(parent, CompileElement, current, CompileElement, control, CompileControl);
            var tagName = DOM.tagName(current.element).toUpperCase();
            if (tagName == 'STYLE') {
              this._processStyleElement(current, control);
            } else if (tagName == 'CONTENT') {
              this._processContentElement(current);
            } else {
              var componentId = current.isBound() ? current.inheritedElementBinder.componentId : null;
              this._shadowDomStrategy.processElement(this._template.componentId, componentId, current.element);
            }
          },
          _processStyleElement: function(current, control) {
            assert.argumentTypes(current, CompileElement, control, CompileControl);
            var stylePromise = this._shadowDomStrategy.processStyleElement(this._template.componentId, this._template.absUrl, current.element);
            if (isPresent(stylePromise) && PromiseWrapper.isPromise(stylePromise)) {
              ListWrapper.push(this._subTaskPromises, stylePromise);
            }
            control.ignoreCurrentElement();
          },
          _processContentElement: function(current) {
            assert.argumentTypes(current, CompileElement);
            if (this._shadowDomStrategy.hasNativeContentElement()) {
              return ;
            }
            var attrs = current.attrs();
            var selector = MapWrapper.get(attrs, 'select');
            selector = isPresent(selector) ? selector : '';
            var contentStart = DOM.createScriptTag('type', 'ng/contentStart');
            if (assertionsEnabled()) {
              DOM.setAttribute(contentStart, 'select', selector);
            }
            var contentEnd = DOM.createScriptTag('type', 'ng/contentEnd');
            DOM.insertBefore(current.element, contentStart);
            DOM.insertBefore(current.element, contentEnd);
            DOM.remove(current.element);
            current.element = contentStart;
            current.bindElement().setContentTagSelector(selector);
          }
        }, {}, $__super);
      }(CompileStep)));
      Object.defineProperty(ShadowDomCompileStep, "parameters", {get: function() {
        return [[ShadowDomStrategy], [ViewDefinition], [assert.genericType(List, Promise)]];
      }});
      Object.defineProperty(ShadowDomCompileStep.prototype.process, "parameters", {get: function() {
        return [[CompileElement], [CompileElement], [CompileControl]];
      }});
      Object.defineProperty(ShadowDomCompileStep.prototype._processStyleElement, "parameters", {get: function() {
        return [[CompileElement], [CompileControl]];
      }});
      Object.defineProperty(ShadowDomCompileStep.prototype._processContentElement, "parameters", {get: function() {
        return [[CompileElement]];
      }});
    }
  };
});

System.register("angular2/src/core/compiler/base_query_list", ["angular2/src/facade/collection", "angular2/src/core/annotations/annotations"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/compiler/base_query_list";
  var List,
    MapWrapper,
    ListWrapper,
    Directive,
    BaseQueryList;
  return {
    setters: [function($__m) {
      List = $__m.List;
      MapWrapper = $__m.MapWrapper;
      ListWrapper = $__m.ListWrapper;
    }, function($__m) {
      Directive = $__m.Directive;
    }],
    execute: function() {
      BaseQueryList = $__export("BaseQueryList", (function() {
        var $__1;
        var BaseQueryList = function BaseQueryList() {
          this._results = [];
          this._callbacks = [];
          this._dirty = false;
        };
        return ($traceurRuntime.createClass)(BaseQueryList, ($__1 = {}, Object.defineProperty($__1, Symbol.iterator, {
          value: function() {
            return this._results[Symbol.iterator]();
          },
          configurable: true,
          enumerable: true,
          writable: true
        }), Object.defineProperty($__1, "reset", {
          value: function(newList) {
            this._results = newList;
            this._dirty = true;
          },
          configurable: true,
          enumerable: true,
          writable: true
        }), Object.defineProperty($__1, "add", {
          value: function(obj) {
            ListWrapper.push(this._results, obj);
            this._dirty = true;
          },
          configurable: true,
          enumerable: true,
          writable: true
        }), Object.defineProperty($__1, "fireCallbacks", {
          value: function() {
            if (this._dirty) {
              ListWrapper.forEach(this._callbacks, (function(c) {
                return c();
              }));
              this._dirty = false;
            }
          },
          configurable: true,
          enumerable: true,
          writable: true
        }), Object.defineProperty($__1, "onChange", {
          value: function(callback) {
            ListWrapper.push(this._callbacks, callback);
          },
          configurable: true,
          enumerable: true,
          writable: true
        }), Object.defineProperty($__1, "removeCallback", {
          value: function(callback) {
            ListWrapper.remove(this._callbacks, callback);
          },
          configurable: true,
          enumerable: true,
          writable: true
        }), $__1), {});
      }()));
    }
  };
});

System.register("angular2/src/core/compiler/element_binder", ["rtts_assert/rtts_assert", "angular2/src/facade/lang", "angular2/src/core/compiler/element_injector", "angular2/src/facade/collection", "angular2/src/core/compiler/view"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/compiler/element_binder";
  var assert,
    int,
    isBlank,
    isPresent,
    BaseException,
    eiModule,
    DirectiveBinding,
    List,
    StringMap,
    viewModule,
    ElementBinder;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      int = $__m.int;
      isBlank = $__m.isBlank;
      isPresent = $__m.isPresent;
      BaseException = $__m.BaseException;
    }, function($__m) {
      DirectiveBinding = $__m.DirectiveBinding;
      eiModule = $__m;
    }, function($__m) {
      List = $__m.List;
      StringMap = $__m.StringMap;
    }, function($__m) {
      viewModule = $__m;
    }],
    execute: function() {
      ElementBinder = $__export("ElementBinder", (function() {
        var ElementBinder = function ElementBinder(index, parent, distanceToParent, protoElementInjector, componentDirective, viewportDirective) {
          assert.argumentTypes(index, int, parent, ElementBinder, distanceToParent, int, protoElementInjector, eiModule.ProtoElementInjector, componentDirective, DirectiveBinding, viewportDirective, DirectiveBinding);
          if (isBlank(index)) {
            throw new BaseException('null index not allowed.');
          }
          this.protoElementInjector = protoElementInjector;
          this.componentDirective = componentDirective;
          this.viewportDirective = viewportDirective;
          this.parent = parent;
          this.index = index;
          this.distanceToParent = distanceToParent;
          this.hostListeners = null;
          this.nestedProtoView = null;
        };
        return ($traceurRuntime.createClass)(ElementBinder, {
          hasStaticComponent: function() {
            return isPresent(this.componentDirective) && isPresent(this.nestedProtoView);
          },
          hasDynamicComponent: function() {
            return isPresent(this.componentDirective) && isBlank(this.nestedProtoView);
          }
        }, {});
      }()));
      Object.defineProperty(ElementBinder, "parameters", {get: function() {
        return [[int], [ElementBinder], [int], [eiModule.ProtoElementInjector], [DirectiveBinding], [DirectiveBinding]];
      }});
    }
  };
});

System.register("angular2/src/core/compiler/view_hydrator", ["rtts_assert/rtts_assert", "angular2/di", "angular2/src/facade/collection", "angular2/src/core/compiler/element_injector", "angular2/src/facade/lang", "angular2/src/core/compiler/view_container", "angular2/src/core/compiler/view", "angular2/change_detection", "angular2/src/render/api"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/compiler/view_hydrator";
  var assert,
    Injectable,
    Inject,
    OpaqueToken,
    Injector,
    ListWrapper,
    MapWrapper,
    Map,
    StringMapWrapper,
    List,
    eli,
    isPresent,
    isBlank,
    BaseException,
    vcModule,
    viewModule,
    BindingPropagationConfig,
    Locals,
    renderApi,
    AppViewHydrator;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Injectable = $__m.Injectable;
      Inject = $__m.Inject;
      OpaqueToken = $__m.OpaqueToken;
      Injector = $__m.Injector;
    }, function($__m) {
      ListWrapper = $__m.ListWrapper;
      MapWrapper = $__m.MapWrapper;
      Map = $__m.Map;
      StringMapWrapper = $__m.StringMapWrapper;
      List = $__m.List;
    }, function($__m) {
      eli = $__m;
    }, function($__m) {
      isPresent = $__m.isPresent;
      isBlank = $__m.isBlank;
      BaseException = $__m.BaseException;
    }, function($__m) {
      vcModule = $__m;
    }, function($__m) {
      viewModule = $__m;
    }, function($__m) {
      BindingPropagationConfig = $__m.BindingPropagationConfig;
      Locals = $__m.Locals;
    }, function($__m) {
      renderApi = $__m;
    }],
    execute: function() {
      AppViewHydrator = $__export("AppViewHydrator", (function() {
        var AppViewHydrator = function AppViewHydrator(renderer) {
          assert.argumentTypes(renderer, renderApi.Renderer);
          this._renderer = renderer;
        };
        return ($traceurRuntime.createClass)(AppViewHydrator, {
          hydrateDynamicComponentView: function(hostView, boundElementIndex, componentView, componentDirective, injector) {
            assert.argumentTypes(hostView, viewModule.AppView, boundElementIndex, assert.type.number, componentView, viewModule.AppView, componentDirective, eli.DirectiveBinding, injector, Injector);
            var binder = hostView.proto.elementBinders[boundElementIndex];
            if (!binder.hasDynamicComponent()) {
              throw new BaseException(("There is no dynamic component directive at element " + boundElementIndex));
            }
            if (isPresent(hostView.componentChildViews[boundElementIndex])) {
              throw new BaseException(("There already is a bound component at element " + boundElementIndex));
            }
            var hostElementInjector = hostView.elementInjectors[boundElementIndex];
            if (isBlank(injector)) {
              injector = hostElementInjector.getLightDomAppInjector();
            }
            var shadowDomAppInjector = this._createShadowDomAppInjector(componentDirective, injector);
            if (isBlank(shadowDomAppInjector)) {
              shadowDomAppInjector = null;
            }
            var component = hostElementInjector.dynamicallyCreateComponent(componentDirective, shadowDomAppInjector);
            hostView.componentChildViews[boundElementIndex] = componentView;
            hostView.changeDetector.addShadowDomChild(componentView.changeDetector);
            var renderViewRefs = this._renderer.createDynamicComponentView(hostView.render, boundElementIndex, componentView.proto.render);
            this._viewHydrateRecurse(componentView, renderViewRefs, 0, shadowDomAppInjector, hostElementInjector, component, null);
          },
          dehydrateDynamicComponentView: function(parentView, boundElementIndex) {
            assert.argumentTypes(parentView, viewModule.AppView, boundElementIndex, assert.type.number);
            throw new BaseException('Not yet implemented!');
          },
          hydrateInPlaceHostView: function(parentView, hostElementSelector, hostView, injector) {
            assert.argumentTypes(parentView, viewModule.AppView, hostElementSelector, assert.type.any, hostView, viewModule.AppView, injector, Injector);
            var parentRenderViewRef = null;
            if (isPresent(parentView)) {
              throw new BaseException('Not yet supported');
            }
            var binder = hostView.proto.elementBinders[0];
            var shadowDomAppInjector = this._createShadowDomAppInjector(binder.componentDirective, injector);
            var renderViewRefs = this._renderer.createInPlaceHostView(parentRenderViewRef, hostElementSelector, hostView.proto.render);
            this._viewHydrateRecurse(hostView, renderViewRefs, 0, shadowDomAppInjector, null, new Object(), null);
          },
          dehydrateInPlaceHostView: function(parentView, hostView) {
            assert.argumentTypes(parentView, viewModule.AppView, hostView, viewModule.AppView);
            var parentRenderViewRef = null;
            if (isPresent(parentView)) {
              throw new BaseException('Not yet supported');
            }
            var render = hostView.render;
            this._viewDehydrateRecurse(hostView);
            this._renderer.destroyInPlaceHostView(parentRenderViewRef, render);
          },
          hydrateViewInViewContainer: function(viewContainer, atIndex, view) {
            var injector = arguments[3] !== (void 0) ? arguments[3] : null;
            assert.argumentTypes(viewContainer, vcModule.ViewContainer, atIndex, assert.type.number, view, viewModule.AppView, injector, Injector);
            if (!viewContainer.hydrated())
              throw new BaseException('Cannot create views on a dehydrated ViewContainer');
            if (isBlank(injector)) {
              injector = viewContainer.elementInjector.getLightDomAppInjector();
            }
            var renderViewRefs = this._renderer.createViewInContainer(viewContainer.getRender(), atIndex, view.proto.render);
            viewContainer.parentView.changeDetector.addChild(view.changeDetector);
            this._viewHydrateRecurse(view, renderViewRefs, 0, injector, viewContainer.elementInjector.getHost(), viewContainer.parentView.context, viewContainer.parentView.locals);
          },
          dehydrateViewInViewContainer: function(viewContainer, atIndex, view) {
            assert.argumentTypes(viewContainer, vcModule.ViewContainer, atIndex, assert.type.number, view, viewModule.AppView);
            view.changeDetector.remove();
            this._viewDehydrateRecurse(view);
            this._renderer.destroyViewInContainer(viewContainer.getRender(), atIndex);
          },
          _viewHydrateRecurse: function(view, renderComponentViewRefs, renderComponentIndex, appInjector, hostElementInjector, context, locals) {
            assert.argumentTypes(view, viewModule.AppView, renderComponentViewRefs, assert.genericType(List, renderApi.ViewRef), renderComponentIndex, assert.type.number, appInjector, Injector, hostElementInjector, eli.ElementInjector, context, Object, locals, Locals);
            if (view.hydrated())
              throw new BaseException('The view is already hydrated.');
            view.render = renderComponentViewRefs[renderComponentIndex++];
            view.context = context;
            view.locals.parent = locals;
            var binders = view.proto.elementBinders;
            for (var i = 0; i < binders.length; ++i) {
              var componentDirective = binders[i].componentDirective;
              var shadowDomAppInjector = null;
              if (isPresent(componentDirective)) {
                shadowDomAppInjector = this._createShadowDomAppInjector(componentDirective, appInjector);
              } else {
                shadowDomAppInjector = null;
              }
              var elementInjector = view.elementInjectors[i];
              if (isPresent(elementInjector)) {
                elementInjector.instantiateDirectives(appInjector, hostElementInjector, shadowDomAppInjector, view.preBuiltObjects[i]);
                this._setUpEventEmitters(view, elementInjector, i);
                var exportImplicitName = elementInjector.getExportImplicitName();
                if (elementInjector.isExportingComponent()) {
                  view.locals.set(exportImplicitName, elementInjector.getComponent());
                } else if (elementInjector.isExportingElement()) {
                  view.locals.set(exportImplicitName, elementInjector.getNgElement().domElement);
                }
              }
              if (binders[i].hasStaticComponent()) {
                renderComponentIndex = this._viewHydrateRecurse(view.componentChildViews[i], renderComponentViewRefs, renderComponentIndex, shadowDomAppInjector, elementInjector, elementInjector.getComponent(), null);
              }
            }
            view.changeDetector.hydrate(view.context, view.locals, view);
            view.renderer.setEventDispatcher(view.render, view);
            return assert.returnType((renderComponentIndex), assert.type.number);
          },
          _setUpEventEmitters: function(view, elementInjector, boundElementIndex) {
            assert.argumentTypes(view, viewModule.AppView, elementInjector, eli.ElementInjector, boundElementIndex, assert.type.number);
            var emitters = elementInjector.getEventEmitterAccessors();
            for (var directiveIndex = 0; directiveIndex < emitters.length; ++directiveIndex) {
              var directiveEmitters = emitters[directiveIndex];
              var directive = elementInjector.getDirectiveAtIndex(directiveIndex);
              for (var eventIndex = 0; eventIndex < directiveEmitters.length; ++eventIndex) {
                var eventEmitterAccessor = directiveEmitters[eventIndex];
                eventEmitterAccessor.subscribe(view, boundElementIndex, directive);
              }
            }
          },
          _viewDehydrateRecurse: function(view) {
            assert.argumentTypes(view, viewModule.AppView);
            for (var i = 0; i < view.componentChildViews.length; i++) {
              var componentView = view.componentChildViews[i];
              if (isPresent(componentView)) {
                this._viewDehydrateRecurse(componentView);
                var binder = view.proto.elementBinders[i];
                if (binder.hasDynamicComponent()) {
                  view.componentChildViews[i] = null;
                  view.changeDetector.removeShadowDomChild(componentView.changeDetector);
                }
              }
            }
            for (var i = 0; i < view.elementInjectors.length; i++) {
              if (isPresent(view.elementInjectors[i])) {
                view.elementInjectors[i].clearDirectives();
              }
            }
            if (isPresent(view.viewContainers)) {
              for (var i = 0; i < view.viewContainers.length; i++) {
                var vc = view.viewContainers[i];
                if (isPresent(vc)) {
                  this._viewContainerDehydrateRecurse(vc);
                }
              }
            }
            view.render = null;
            if (isPresent(view.locals)) {
              view.locals.clearValues();
            }
            view.context = null;
            view.changeDetector.dehydrate();
          },
          _createShadowDomAppInjector: function(componentDirective, appInjector) {
            var shadowDomAppInjector = null;
            var injectables = componentDirective.resolvedInjectables;
            if (isPresent(injectables)) {
              shadowDomAppInjector = appInjector.createChildFromResolved(injectables);
            } else {
              shadowDomAppInjector = appInjector;
            }
            return shadowDomAppInjector;
          },
          _viewContainerDehydrateRecurse: function(viewContainer) {
            assert.argumentTypes(viewContainer, vcModule.ViewContainer);
            for (var i = 0; i < viewContainer.length; i++) {
              var view = viewContainer.get(i);
              view.changeDetector.remove();
              this._viewDehydrateRecurse(view);
            }
            viewContainer.internalClearWithoutRender();
          }
        }, {});
      }()));
      Object.defineProperty(AppViewHydrator, "annotations", {get: function() {
        return [new Injectable()];
      }});
      Object.defineProperty(AppViewHydrator, "parameters", {get: function() {
        return [[renderApi.Renderer]];
      }});
      Object.defineProperty(AppViewHydrator.prototype.hydrateDynamicComponentView, "parameters", {get: function() {
        return [[viewModule.AppView], [assert.type.number], [viewModule.AppView], [eli.DirectiveBinding], [Injector]];
      }});
      Object.defineProperty(AppViewHydrator.prototype.dehydrateDynamicComponentView, "parameters", {get: function() {
        return [[viewModule.AppView], [assert.type.number]];
      }});
      Object.defineProperty(AppViewHydrator.prototype.hydrateInPlaceHostView, "parameters", {get: function() {
        return [[viewModule.AppView], [], [viewModule.AppView], [Injector]];
      }});
      Object.defineProperty(AppViewHydrator.prototype.dehydrateInPlaceHostView, "parameters", {get: function() {
        return [[viewModule.AppView], [viewModule.AppView]];
      }});
      Object.defineProperty(AppViewHydrator.prototype.hydrateViewInViewContainer, "parameters", {get: function() {
        return [[vcModule.ViewContainer], [assert.type.number], [viewModule.AppView], [Injector]];
      }});
      Object.defineProperty(AppViewHydrator.prototype.dehydrateViewInViewContainer, "parameters", {get: function() {
        return [[vcModule.ViewContainer], [assert.type.number], [viewModule.AppView]];
      }});
      Object.defineProperty(AppViewHydrator.prototype._viewHydrateRecurse, "parameters", {get: function() {
        return [[viewModule.AppView], [assert.genericType(List, renderApi.ViewRef)], [assert.type.number], [Injector], [eli.ElementInjector], [Object], [Locals]];
      }});
      Object.defineProperty(AppViewHydrator.prototype._setUpEventEmitters, "parameters", {get: function() {
        return [[viewModule.AppView], [eli.ElementInjector], [assert.type.number]];
      }});
      Object.defineProperty(AppViewHydrator.prototype._viewDehydrateRecurse, "parameters", {get: function() {
        return [[viewModule.AppView]];
      }});
      Object.defineProperty(AppViewHydrator.prototype._viewContainerDehydrateRecurse, "parameters", {get: function() {
        return [[vcModule.ViewContainer]];
      }});
    }
  };
});

System.register("angular2/src/core/compiler/template_resolver", ["rtts_assert/rtts_assert", "angular2/di", "angular2/src/core/annotations/view", "angular2/src/facade/lang", "angular2/src/facade/collection", "angular2/src/reflection/reflection"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/compiler/template_resolver";
  var assert,
    Injectable,
    ViewAnnotation,
    Type,
    stringify,
    isBlank,
    BaseException,
    Map,
    MapWrapper,
    List,
    ListWrapper,
    reflector,
    TemplateResolver;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      ViewAnnotation = $__m.ViewAnnotation;
    }, function($__m) {
      Type = $__m.Type;
      stringify = $__m.stringify;
      isBlank = $__m.isBlank;
      BaseException = $__m.BaseException;
    }, function($__m) {
      Map = $__m.Map;
      MapWrapper = $__m.MapWrapper;
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
    }, function($__m) {
      reflector = $__m.reflector;
    }],
    execute: function() {
      TemplateResolver = $__export("TemplateResolver", (function() {
        var TemplateResolver = function TemplateResolver() {
          this._cache = MapWrapper.create();
        };
        return ($traceurRuntime.createClass)(TemplateResolver, {
          resolve: function(component) {
            assert.argumentTypes(component, Type);
            var view = MapWrapper.get(this._cache, component);
            if (isBlank(view)) {
              view = this._resolve(component);
              MapWrapper.set(this._cache, component, view);
            }
            return assert.returnType((view), ViewAnnotation);
          },
          _resolve: function(component) {
            assert.argumentTypes(component, Type);
            var annotations = reflector.annotations(component);
            for (var i = 0; i < annotations.length; i++) {
              var annotation = annotations[i];
              if (annotation instanceof ViewAnnotation) {
                return annotation;
              }
            }
            throw new BaseException(("No template found for " + stringify(component)));
          }
        }, {});
      }()));
      Object.defineProperty(TemplateResolver, "annotations", {get: function() {
        return [new Injectable()];
      }});
      Object.defineProperty(TemplateResolver.prototype.resolve, "parameters", {get: function() {
        return [[Type]];
      }});
      Object.defineProperty(TemplateResolver.prototype._resolve, "parameters", {get: function() {
        return [[Type]];
      }});
    }
  };
});

System.register("angular2/src/core/compiler/component_url_mapper", ["rtts_assert/rtts_assert", "angular2/di", "angular2/src/facade/lang", "angular2/src/facade/collection"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/compiler/component_url_mapper";
  var assert,
    Injectable,
    Type,
    isPresent,
    Map,
    MapWrapper,
    ComponentUrlMapper,
    RuntimeComponentUrlMapper;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      Type = $__m.Type;
      isPresent = $__m.isPresent;
    }, function($__m) {
      Map = $__m.Map;
      MapWrapper = $__m.MapWrapper;
    }],
    execute: function() {
      ComponentUrlMapper = $__export("ComponentUrlMapper", (function() {
        var ComponentUrlMapper = function ComponentUrlMapper() {
          ;
        };
        return ($traceurRuntime.createClass)(ComponentUrlMapper, {getUrl: function(component) {
          assert.argumentTypes(component, Type);
          return assert.returnType(('./'), assert.type.string);
        }}, {});
      }()));
      Object.defineProperty(ComponentUrlMapper, "annotations", {get: function() {
        return [new Injectable()];
      }});
      Object.defineProperty(ComponentUrlMapper.prototype.getUrl, "parameters", {get: function() {
        return [[Type]];
      }});
      RuntimeComponentUrlMapper = $__export("RuntimeComponentUrlMapper", (function($__super) {
        var RuntimeComponentUrlMapper = function RuntimeComponentUrlMapper() {
          $traceurRuntime.superConstructor(RuntimeComponentUrlMapper).call(this);
          this._componentUrls = MapWrapper.create();
        };
        return ($traceurRuntime.createClass)(RuntimeComponentUrlMapper, {
          setComponentUrl: function(component, url) {
            assert.argumentTypes(component, Type, url, assert.type.string);
            MapWrapper.set(this._componentUrls, component, url);
          },
          getUrl: function(component) {
            assert.argumentTypes(component, Type);
            var url = MapWrapper.get(this._componentUrls, component);
            if (isPresent(url))
              return assert.returnType((url), assert.type.string);
            return assert.returnType(($traceurRuntime.superGet(this, RuntimeComponentUrlMapper.prototype, "getUrl").call(this, component)), assert.type.string);
          }
        }, {}, $__super);
      }(ComponentUrlMapper)));
      Object.defineProperty(RuntimeComponentUrlMapper.prototype.setComponentUrl, "parameters", {get: function() {
        return [[Type], [assert.type.string]];
      }});
      Object.defineProperty(RuntimeComponentUrlMapper.prototype.getUrl, "parameters", {get: function() {
        return [[Type]];
      }});
    }
  };
});

System.register("angular2/src/core/compiler/proto_view_factory", ["rtts_assert/rtts_assert", "angular2/di", "angular2/src/facade/collection", "angular2/src/facade/lang", "angular2/src/reflection/reflection", "angular2/change_detection", "angular2/src/core/annotations/annotations", "angular2/src/render/api", "angular2/src/core/compiler/view", "angular2/src/core/compiler/element_injector"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/compiler/proto_view_factory";
  var assert,
    Injectable,
    List,
    ListWrapper,
    MapWrapper,
    isPresent,
    isBlank,
    reflector,
    ChangeDetection,
    ComponentAnnotation,
    ViewportAnnotation,
    DynamicComponentAnnotation,
    renderApi,
    AppProtoView,
    ProtoElementInjector,
    DirectiveBinding,
    ProtoViewFactory,
    SortedDirectives,
    ParentProtoElementInjectorWithDistance;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
      MapWrapper = $__m.MapWrapper;
    }, function($__m) {
      isPresent = $__m.isPresent;
      isBlank = $__m.isBlank;
    }, function($__m) {
      reflector = $__m.reflector;
    }, function($__m) {
      ChangeDetection = $__m.ChangeDetection;
    }, function($__m) {
      ComponentAnnotation = $__m.ComponentAnnotation;
      ViewportAnnotation = $__m.ViewportAnnotation;
      DynamicComponentAnnotation = $__m.DynamicComponentAnnotation;
    }, function($__m) {
      renderApi = $__m;
    }, function($__m) {
      AppProtoView = $__m.AppProtoView;
    }, function($__m) {
      ProtoElementInjector = $__m.ProtoElementInjector;
      DirectiveBinding = $__m.DirectiveBinding;
    }],
    execute: function() {
      ProtoViewFactory = $__export("ProtoViewFactory", (function() {
        var ProtoViewFactory = function ProtoViewFactory(changeDetection) {
          assert.argumentTypes(changeDetection, ChangeDetection);
          this._changeDetection = changeDetection;
        };
        return ($traceurRuntime.createClass)(ProtoViewFactory, {
          createProtoView: function(componentBinding, renderProtoView, directives) {
            assert.argumentTypes(componentBinding, DirectiveBinding, renderProtoView, renderApi.ProtoViewDto, directives, assert.genericType(List, DirectiveBinding));
            var protoChangeDetector;
            if (isBlank(componentBinding)) {
              protoChangeDetector = this._changeDetection.createProtoChangeDetector('root', null);
            } else {
              var componentAnnotation = assert.type(componentBinding.annotation, ComponentAnnotation);
              protoChangeDetector = this._changeDetection.createProtoChangeDetector('dummy', componentAnnotation.changeDetection);
            }
            var protoView = new AppProtoView(renderProtoView.render, protoChangeDetector);
            for (var i = 0; i < renderProtoView.elementBinders.length; i++) {
              var renderElementBinder = renderProtoView.elementBinders[i];
              var sortedDirectives = new SortedDirectives(renderElementBinder.directives, directives);
              var parentPeiWithDistance = this._findParentProtoElementInjectorWithDistance(i, protoView.elementBinders, renderProtoView.elementBinders);
              var protoElementInjector = this._createProtoElementInjector(i, parentPeiWithDistance, sortedDirectives, renderElementBinder);
              this._createElementBinder(protoView, renderElementBinder, protoElementInjector, sortedDirectives);
              this._createDirectiveBinders(protoView, sortedDirectives);
            }
            MapWrapper.forEach(renderProtoView.variableBindings, (function(mappedName, varName) {
              protoView.bindVariable(varName, mappedName);
            }));
            return assert.returnType((protoView), AppProtoView);
          },
          _findParentProtoElementInjectorWithDistance: function(binderIndex, elementBinders, renderElementBinders) {
            var distance = 0;
            do {
              var renderElementBinder = renderElementBinders[binderIndex];
              binderIndex = renderElementBinder.parentIndex;
              if (binderIndex !== -1) {
                distance += renderElementBinder.distanceToParent;
                var elementBinder = elementBinders[binderIndex];
                if (isPresent(elementBinder.protoElementInjector)) {
                  return new ParentProtoElementInjectorWithDistance(elementBinder.protoElementInjector, distance);
                }
              }
            } while (binderIndex !== -1);
            return new ParentProtoElementInjectorWithDistance(null, -1);
          },
          _createProtoElementInjector: function(binderIndex, parentPeiWithDistance, sortedDirectives, renderElementBinder) {
            var protoElementInjector = null;
            var hasVariables = MapWrapper.size(renderElementBinder.variableBindings) > 0;
            if (sortedDirectives.directives.length > 0 || hasVariables) {
              protoElementInjector = new ProtoElementInjector(parentPeiWithDistance.protoElementInjector, binderIndex, sortedDirectives.directives, isPresent(sortedDirectives.componentDirective), parentPeiWithDistance.distance);
              protoElementInjector.attributes = renderElementBinder.readAttributes;
              if (hasVariables && !isPresent(sortedDirectives.viewportDirective)) {
                protoElementInjector.exportComponent = isPresent(sortedDirectives.componentDirective);
                protoElementInjector.exportElement = isBlank(sortedDirectives.componentDirective);
                var exportImplicitName = MapWrapper.get(renderElementBinder.variableBindings, '\$implicit');
                if (isPresent(exportImplicitName)) {
                  protoElementInjector.exportImplicitName = exportImplicitName;
                }
              }
            }
            return protoElementInjector;
          },
          _createElementBinder: function(protoView, renderElementBinder, protoElementInjector, sortedDirectives) {
            var parent = null;
            if (renderElementBinder.parentIndex !== -1) {
              parent = protoView.elementBinders[renderElementBinder.parentIndex];
            }
            var elBinder = protoView.bindElement(parent, renderElementBinder.distanceToParent, protoElementInjector, sortedDirectives.componentDirective, sortedDirectives.viewportDirective);
            for (var i = 0; i < renderElementBinder.textBindings.length; i++) {
              protoView.bindTextNode(renderElementBinder.textBindings[i]);
            }
            MapWrapper.forEach(renderElementBinder.propertyBindings, (function(astWithSource, propertyName) {
              protoView.bindElementProperty(astWithSource, propertyName);
            }));
            protoView.bindEvent(renderElementBinder.eventBindings, -1);
            MapWrapper.forEach(renderElementBinder.variableBindings, (function(mappedName, varName) {
              MapWrapper.set(protoView.protoLocals, mappedName, null);
            }));
            return elBinder;
          },
          _createDirectiveBinders: function(protoView, sortedDirectives) {
            for (var i = 0; i < sortedDirectives.renderDirectives.length; i++) {
              var renderDirectiveMetadata = sortedDirectives.renderDirectives[i];
              MapWrapper.forEach(renderDirectiveMetadata.propertyBindings, (function(astWithSource, propertyName) {
                var setter = reflector.setter(propertyName);
                protoView.bindDirectiveProperty(i, astWithSource, propertyName, setter);
              }));
              protoView.bindEvent(renderDirectiveMetadata.eventBindings, i);
            }
          }
        }, {});
      }()));
      Object.defineProperty(ProtoViewFactory, "annotations", {get: function() {
        return [new Injectable()];
      }});
      Object.defineProperty(ProtoViewFactory, "parameters", {get: function() {
        return [[ChangeDetection]];
      }});
      Object.defineProperty(ProtoViewFactory.prototype.createProtoView, "parameters", {get: function() {
        return [[DirectiveBinding], [renderApi.ProtoViewDto], [assert.genericType(List, DirectiveBinding)]];
      }});
      SortedDirectives = (function() {
        var SortedDirectives = function SortedDirectives(renderDirectives, allDirectives) {
          var $__0 = this;
          this.renderDirectives = [];
          this.directives = [];
          this.viewportDirective = null;
          this.componentDirective = null;
          ListWrapper.forEach(renderDirectives, (function(renderDirectiveMetadata) {
            var directiveBinding = allDirectives[renderDirectiveMetadata.directiveIndex];
            if ((directiveBinding.annotation instanceof ComponentAnnotation) || (directiveBinding.annotation instanceof DynamicComponentAnnotation)) {
              $__0.componentDirective = directiveBinding;
              ListWrapper.insert($__0.renderDirectives, 0, renderDirectiveMetadata);
              ListWrapper.insert($__0.directives, 0, directiveBinding);
            } else {
              if (directiveBinding.annotation instanceof ViewportAnnotation) {
                $__0.viewportDirective = directiveBinding;
              }
              ListWrapper.push($__0.renderDirectives, renderDirectiveMetadata);
              ListWrapper.push($__0.directives, directiveBinding);
            }
          }));
        };
        return ($traceurRuntime.createClass)(SortedDirectives, {}, {});
      }());
      ParentProtoElementInjectorWithDistance = (function() {
        var ParentProtoElementInjectorWithDistance = function ParentProtoElementInjectorWithDistance(protoElementInjector, distance) {
          assert.argumentTypes(protoElementInjector, ProtoElementInjector, distance, assert.type.number);
          this.protoElementInjector = protoElementInjector;
          this.distance = distance;
        };
        return ($traceurRuntime.createClass)(ParentProtoElementInjectorWithDistance, {}, {});
      }());
      Object.defineProperty(ParentProtoElementInjectorWithDistance, "parameters", {get: function() {
        return [[ProtoElementInjector], [assert.type.number]];
      }});
    }
  };
});

System.register("angular2/src/core/exception_handler", ["angular2/di", "angular2/src/facade/lang", "angular2/src/facade/collection"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/exception_handler";
  var Injectable,
    isPresent,
    print,
    ListWrapper,
    isListLikeIterable,
    ExceptionHandler;
  return {
    setters: [function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      isPresent = $__m.isPresent;
      print = $__m.print;
    }, function($__m) {
      ListWrapper = $__m.ListWrapper;
      isListLikeIterable = $__m.isListLikeIterable;
    }],
    execute: function() {
      ExceptionHandler = $__export("ExceptionHandler", (function() {
        var ExceptionHandler = function ExceptionHandler() {
          ;
        };
        return ($traceurRuntime.createClass)(ExceptionHandler, {call: function(error) {
          var stackTrace = arguments[1] !== (void 0) ? arguments[1] : null;
          var reason = arguments[2] !== (void 0) ? arguments[2] : null;
          var longStackTrace = isListLikeIterable(stackTrace) ? ListWrapper.join(stackTrace, "\n\n") : stackTrace;
          var reasonStr = isPresent(reason) ? ("\n" + reason) : '';
          print(("" + error + reasonStr + "\nSTACKTRACE:\n" + longStackTrace));
        }}, {});
      }()));
      Object.defineProperty(ExceptionHandler, "annotations", {get: function() {
        return [new Injectable()];
      }});
    }
  };
});

System.register("angular2/src/core/life_cycle/life_cycle", ["rtts_assert/rtts_assert", "angular2/di", "angular2/change_detection", "angular2/src/core/zone/vm_turn_zone", "angular2/src/core/exception_handler", "angular2/src/facade/lang"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/core/life_cycle/life_cycle";
  var assert,
    Injectable,
    ChangeDetector,
    VmTurnZone,
    ExceptionHandler,
    isPresent,
    LifeCycle;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      ChangeDetector = $__m.ChangeDetector;
    }, function($__m) {
      VmTurnZone = $__m.VmTurnZone;
    }, function($__m) {
      ExceptionHandler = $__m.ExceptionHandler;
    }, function($__m) {
      isPresent = $__m.isPresent;
    }],
    execute: function() {
      LifeCycle = $__export("LifeCycle", (function() {
        var LifeCycle = function LifeCycle(exceptionHandler) {
          var changeDetector = arguments[1] !== (void 0) ? arguments[1] : null;
          var enforceNoNewChanges = arguments[2] !== (void 0) ? arguments[2] : false;
          assert.argumentTypes(exceptionHandler, ExceptionHandler, changeDetector, ChangeDetector, enforceNoNewChanges, assert.type.boolean);
          this._errorHandler = (function(exception, stackTrace) {
            exceptionHandler.call(exception, stackTrace);
            throw exception;
          });
          this._changeDetector = changeDetector;
          this._enforceNoNewChanges = enforceNoNewChanges;
        };
        return ($traceurRuntime.createClass)(LifeCycle, {
          registerWith: function(zone) {
            var changeDetector = arguments[1] !== (void 0) ? arguments[1] : null;
            var $__0 = this;
            if (isPresent(changeDetector)) {
              this._changeDetector = changeDetector;
            }
            zone.initCallbacks({
              onErrorHandler: this._errorHandler,
              onTurnDone: (function() {
                return $__0.tick();
              })
            });
          },
          tick: function() {
            this._changeDetector.detectChanges();
            if (this._enforceNoNewChanges) {
              this._changeDetector.checkNoChanges();
            }
          }
        }, {});
      }()));
      Object.defineProperty(LifeCycle, "annotations", {get: function() {
        return [new Injectable()];
      }});
      Object.defineProperty(LifeCycle, "parameters", {get: function() {
        return [[ExceptionHandler], [ChangeDetector], [assert.type.boolean]];
      }});
      Object.defineProperty(LifeCycle.prototype.registerWith, "parameters", {get: function() {
        return [[VmTurnZone], [ChangeDetector]];
      }});
    }
  };
});

System.register("angular2/src/render/dom/shadow_dom/style_url_resolver", ["rtts_assert/rtts_assert", "angular2/di", "angular2/src/facade/lang", "angular2/src/services/url_resolver"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/shadow_dom/style_url_resolver";
  var assert,
    Injectable,
    RegExp,
    RegExpWrapper,
    StringWrapper,
    UrlResolver,
    StyleUrlResolver,
    _cssUrlRe,
    _cssImportRe,
    _quoteRe;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      RegExp = $__m.RegExp;
      RegExpWrapper = $__m.RegExpWrapper;
      StringWrapper = $__m.StringWrapper;
    }, function($__m) {
      UrlResolver = $__m.UrlResolver;
    }],
    execute: function() {
      StyleUrlResolver = $__export("StyleUrlResolver", (function() {
        var StyleUrlResolver = function StyleUrlResolver(resolver) {
          assert.argumentTypes(resolver, UrlResolver);
          this._resolver = resolver;
        };
        return ($traceurRuntime.createClass)(StyleUrlResolver, {
          resolveUrls: function(cssText, baseUrl) {
            assert.argumentTypes(cssText, assert.type.string, baseUrl, assert.type.string);
            cssText = this._replaceUrls(cssText, _cssUrlRe, baseUrl);
            cssText = this._replaceUrls(cssText, _cssImportRe, baseUrl);
            return cssText;
          },
          _replaceUrls: function(cssText, re, baseUrl) {
            var $__0 = this;
            assert.argumentTypes(cssText, assert.type.string, re, RegExp, baseUrl, assert.type.string);
            return StringWrapper.replaceAllMapped(cssText, re, (function(m) {
              var pre = m[1];
              var url = StringWrapper.replaceAll(m[2], _quoteRe, '');
              var post = m[3];
              var resolvedUrl = $__0._resolver.resolve(baseUrl, url);
              return pre + "'" + resolvedUrl + "'" + post;
            }));
          }
        }, {});
      }()));
      Object.defineProperty(StyleUrlResolver, "annotations", {get: function() {
        return [new Injectable()];
      }});
      Object.defineProperty(StyleUrlResolver, "parameters", {get: function() {
        return [[UrlResolver]];
      }});
      Object.defineProperty(StyleUrlResolver.prototype.resolveUrls, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(StyleUrlResolver.prototype._replaceUrls, "parameters", {get: function() {
        return [[assert.type.string], [RegExp], [assert.type.string]];
      }});
      _cssUrlRe = RegExpWrapper.create('(url\\()([^)]*)(\\))');
      _cssImportRe = RegExpWrapper.create('(@import[\\s]+(?!url\\())[\'"]([^\'"]*)[\'"](.*;)');
      _quoteRe = RegExpWrapper.create('[\'"]');
    }
  };
});

System.register("angular2/src/render/dom/shadow_dom/shadow_css", ["rtts_assert/rtts_assert", "angular2/src/dom/dom_adapter", "angular2/src/facade/collection", "angular2/src/facade/lang"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/render/dom/shadow_dom/shadow_css";
  var assert,
    DOM,
    List,
    ListWrapper,
    StringWrapper,
    RegExp,
    RegExpWrapper,
    RegExpMatcherWrapper,
    isPresent,
    isBlank,
    BaseException,
    int,
    ShadowCss,
    _cssContentNextSelectorRe,
    _cssContentRuleRe,
    _cssContentUnscopedRuleRe,
    _polyfillHost,
    _polyfillHostContext,
    _parenSuffix,
    _cssColonHostRe,
    _cssColonHostContextRe,
    _polyfillHostNoCombinator,
    _shadowDOMSelectorsRe,
    _selectorReSuffix,
    _polyfillHostRe,
    _colonHostRe,
    _colonHostContextRe;
  function _cssToRules(cssText) {
    assert.argumentTypes(cssText, assert.type.string);
    return DOM.cssToRules(cssText);
  }
  function _withCssRules(cssText, callback) {
    assert.argumentTypes(cssText, assert.type.string, callback, Function);
    if (isBlank(callback))
      return ;
    var rules = _cssToRules(cssText);
    callback(rules);
  }
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      DOM = $__m.DOM;
    }, function($__m) {
      List = $__m.List;
      ListWrapper = $__m.ListWrapper;
    }, function($__m) {
      StringWrapper = $__m.StringWrapper;
      RegExp = $__m.RegExp;
      RegExpWrapper = $__m.RegExpWrapper;
      RegExpMatcherWrapper = $__m.RegExpMatcherWrapper;
      isPresent = $__m.isPresent;
      isBlank = $__m.isBlank;
      BaseException = $__m.BaseException;
      int = $__m.int;
    }],
    execute: function() {
      ShadowCss = $__export("ShadowCss", (function() {
        var ShadowCss = function ShadowCss() {
          this.strictStyling = true;
        };
        return ($traceurRuntime.createClass)(ShadowCss, {
          shimStyle: function(style, selector) {
            var hostSelector = arguments[2] !== (void 0) ? arguments[2] : '';
            assert.argumentTypes(style, assert.type.any, selector, assert.type.string, hostSelector, assert.type.string);
            var cssText = DOM.getText(style);
            return assert.returnType((this.shimCssText(cssText, selector, hostSelector)), assert.type.string);
          },
          shimCssText: function(cssText, selector) {
            var hostSelector = arguments[2] !== (void 0) ? arguments[2] : '';
            assert.argumentTypes(cssText, assert.type.string, selector, assert.type.string, hostSelector, assert.type.string);
            cssText = this._insertDirectives(cssText);
            return assert.returnType((this._scopeCssText(cssText, selector, hostSelector)), assert.type.string);
          },
          _insertDirectives: function(cssText) {
            assert.argumentTypes(cssText, assert.type.string);
            cssText = this._insertPolyfillDirectivesInCssText(cssText);
            return assert.returnType((this._insertPolyfillRulesInCssText(cssText)), assert.type.string);
          },
          _insertPolyfillDirectivesInCssText: function(cssText) {
            assert.argumentTypes(cssText, assert.type.string);
            return assert.returnType((StringWrapper.replaceAllMapped(cssText, _cssContentNextSelectorRe, function(m) {
              return m[1] + '{';
            })), assert.type.string);
          },
          _insertPolyfillRulesInCssText: function(cssText) {
            assert.argumentTypes(cssText, assert.type.string);
            return assert.returnType((StringWrapper.replaceAllMapped(cssText, _cssContentRuleRe, function(m) {
              var rule = m[0];
              rule = StringWrapper.replace(rule, m[1], '');
              rule = StringWrapper.replace(rule, m[2], '');
              return m[3] + rule;
            })), assert.type.string);
          },
          _scopeCssText: function(cssText, scopeSelector, hostSelector) {
            var $__0 = this;
            assert.argumentTypes(cssText, assert.type.string, scopeSelector, assert.type.string, hostSelector, assert.type.string);
            var unscoped = this._extractUnscopedRulesFromCssText(cssText);
            cssText = this._insertPolyfillHostInCssText(cssText);
            cssText = this._convertColonHost(cssText);
            cssText = this._convertColonHostContext(cssText);
            cssText = this._convertShadowDOMSelectors(cssText);
            if (isPresent(scopeSelector)) {
              _withCssRules(cssText, (function(rules) {
                cssText = $__0._scopeRules(rules, scopeSelector, hostSelector);
              }));
            }
            cssText = cssText + '\n' + unscoped;
            return assert.returnType((cssText.trim()), assert.type.string);
          },
          _extractUnscopedRulesFromCssText: function(cssText) {
            assert.argumentTypes(cssText, assert.type.string);
            var r = '',
              m;
            var matcher = RegExpWrapper.matcher(_cssContentUnscopedRuleRe, cssText);
            while (isPresent(m = RegExpMatcherWrapper.next(matcher))) {
              var rule = m[0];
              rule = StringWrapper.replace(rule, m[2], '');
              rule = StringWrapper.replace(rule, m[1], m[3]);
              r = rule + '\n\n';
            }
            return assert.returnType((r), assert.type.string);
          },
          _convertColonHost: function(cssText) {
            assert.argumentTypes(cssText, assert.type.string);
            return assert.returnType((this._convertColonRule(cssText, _cssColonHostRe, this._colonHostPartReplacer)), assert.type.string);
          },
          _convertColonHostContext: function(cssText) {
            assert.argumentTypes(cssText, assert.type.string);
            return assert.returnType((this._convertColonRule(cssText, _cssColonHostContextRe, this._colonHostContextPartReplacer)), assert.type.string);
          },
          _convertColonRule: function(cssText, regExp, partReplacer) {
            assert.argumentTypes(cssText, assert.type.string, regExp, RegExp, partReplacer, Function);
            return assert.returnType((StringWrapper.replaceAllMapped(cssText, regExp, function(m) {
              if (isPresent(m[2])) {
                var parts = m[2].split(','),
                  r = [];
                for (var i = 0; i < parts.length; i++) {
                  var p = parts[i];
                  if (isBlank(p))
                    break;
                  p = p.trim();
                  ListWrapper.push(r, partReplacer(_polyfillHostNoCombinator, p, m[3]));
                }
                return r.join(',');
              } else {
                return _polyfillHostNoCombinator + m[3];
              }
            })), assert.type.string);
          },
          _colonHostContextPartReplacer: function(host, part, suffix) {
            assert.argumentTypes(host, assert.type.string, part, assert.type.string, suffix, assert.type.string);
            if (StringWrapper.contains(part, _polyfillHost)) {
              return assert.returnType((this._colonHostPartReplacer(host, part, suffix)), assert.type.string);
            } else {
              return assert.returnType((host + part + suffix + ', ' + part + ' ' + host + suffix), assert.type.string);
            }
          },
          _colonHostPartReplacer: function(host, part, suffix) {
            assert.argumentTypes(host, assert.type.string, part, assert.type.string, suffix, assert.type.string);
            return assert.returnType((host + StringWrapper.replace(part, _polyfillHost, '') + suffix), assert.type.string);
          },
          _convertShadowDOMSelectors: function(cssText) {
            assert.argumentTypes(cssText, assert.type.string);
            for (var i = 0; i < _shadowDOMSelectorsRe.length; i++) {
              cssText = StringWrapper.replaceAll(cssText, _shadowDOMSelectorsRe[i], ' ');
            }
            return assert.returnType((cssText), assert.type.string);
          },
          _scopeRules: function(cssRules, scopeSelector, hostSelector) {
            assert.argumentTypes(cssRules, assert.type.any, scopeSelector, assert.type.string, hostSelector, assert.type.string);
            var cssText = '';
            if (isPresent(cssRules)) {
              for (var i = 0; i < cssRules.length; i++) {
                var rule = cssRules[i];
                if (DOM.isStyleRule(rule) || DOM.isPageRule(rule)) {
                  cssText += this._scopeSelector(rule.selectorText, scopeSelector, hostSelector, this.strictStyling) + ' {\n';
                  cssText += this._propertiesFromRule(rule) + '\n}\n\n';
                } else if (DOM.isMediaRule(rule)) {
                  cssText += '@media ' + rule.media.mediaText + ' {\n';
                  cssText += this._scopeRules(rule.cssRules, scopeSelector, hostSelector);
                  cssText += '\n}\n\n';
                } else {
                  try {
                    if (isPresent(rule.cssText)) {
                      cssText += rule.cssText + '\n\n';
                    }
                  } catch (x) {
                    if (DOM.isKeyframesRule(rule) && isPresent(rule.cssRules)) {
                      cssText += this._ieSafeCssTextFromKeyFrameRule(rule);
                    }
                  }
                }
              }
            }
            return assert.returnType((cssText), assert.type.string);
          },
          _ieSafeCssTextFromKeyFrameRule: function(rule) {
            var cssText = '@keyframes ' + rule.name + ' {';
            for (var i = 0; i < rule.cssRules.length; i++) {
              var r = rule.cssRules[i];
              cssText += ' ' + r.keyText + ' {' + r.style.cssText + '}';
            }
            cssText += ' }';
            return assert.returnType((cssText), assert.type.string);
          },
          _scopeSelector: function(selector, scopeSelector, hostSelector, strict) {
            assert.argumentTypes(selector, assert.type.string, scopeSelector, assert.type.string, hostSelector, assert.type.string, strict, assert.type.boolean);
            var r = [],
              parts = selector.split(',');
            for (var i = 0; i < parts.length; i++) {
              var p = parts[i];
              p = p.trim();
              if (this._selectorNeedsScoping(p, scopeSelector)) {
                p = strict && !StringWrapper.contains(p, _polyfillHostNoCombinator) ? this._applyStrictSelectorScope(p, scopeSelector) : this._applySelectorScope(p, scopeSelector, hostSelector);
              }
              ListWrapper.push(r, p);
            }
            return assert.returnType((r.join(', ')), assert.type.string);
          },
          _selectorNeedsScoping: function(selector, scopeSelector) {
            assert.argumentTypes(selector, assert.type.string, scopeSelector, assert.type.string);
            var re = this._makeScopeMatcher(scopeSelector);
            return assert.returnType((!isPresent(RegExpWrapper.firstMatch(re, selector))), assert.type.boolean);
          },
          _makeScopeMatcher: function(scopeSelector) {
            assert.argumentTypes(scopeSelector, assert.type.string);
            var lre = RegExpWrapper.create('\\[');
            var rre = RegExpWrapper.create('\\]');
            scopeSelector = StringWrapper.replaceAll(scopeSelector, lre, '\\[');
            scopeSelector = StringWrapper.replaceAll(scopeSelector, rre, '\\]');
            return assert.returnType((RegExpWrapper.create('^(' + scopeSelector + ')' + _selectorReSuffix, 'm')), RegExp);
          },
          _applySelectorScope: function(selector, scopeSelector, hostSelector) {
            assert.argumentTypes(selector, assert.type.string, scopeSelector, assert.type.string, hostSelector, assert.type.string);
            return assert.returnType((this._applySimpleSelectorScope(selector, scopeSelector, hostSelector)), assert.type.string);
          },
          _applySimpleSelectorScope: function(selector, scopeSelector, hostSelector) {
            assert.argumentTypes(selector, assert.type.string, scopeSelector, assert.type.string, hostSelector, assert.type.string);
            if (isPresent(RegExpWrapper.firstMatch(_polyfillHostRe, selector))) {
              var replaceBy = this.strictStyling ? ("[" + hostSelector + "]") : scopeSelector;
              selector = StringWrapper.replace(selector, _polyfillHostNoCombinator, replaceBy);
              return assert.returnType((StringWrapper.replaceAll(selector, _polyfillHostRe, replaceBy + ' ')), assert.type.string);
            } else {
              return assert.returnType((scopeSelector + ' ' + selector), assert.type.string);
            }
          },
          _applyStrictSelectorScope: function(selector, scopeSelector) {
            var isRe = RegExpWrapper.create('\\[is=([^\\]]*)\\]');
            scopeSelector = StringWrapper.replaceAllMapped(scopeSelector, isRe, (function(m) {
              return m[1];
            }));
            var splits = [' ', '>', '+', '~'],
              scoped = selector,
              attrName = '[' + scopeSelector + ']';
            for (var i = 0; i < splits.length; i++) {
              var sep = splits[i];
              var parts = scoped.split(sep);
              scoped = ListWrapper.map(parts, function(p) {
                var t = StringWrapper.replaceAll(p.trim(), _polyfillHostRe, '');
                if (t.length > 0 && !ListWrapper.contains(splits, t) && !StringWrapper.contains(t, attrName)) {
                  var re = RegExpWrapper.create('([^:]*)(:*)(.*)');
                  var m = RegExpWrapper.firstMatch(re, t);
                  if (isPresent(m)) {
                    p = m[1] + attrName + m[2] + m[3];
                  }
                }
                return p;
              }).join(sep);
            }
            return assert.returnType((scoped), assert.type.string);
          },
          _insertPolyfillHostInCssText: function(selector) {
            assert.argumentTypes(selector, assert.type.string);
            selector = StringWrapper.replaceAll(selector, _colonHostContextRe, _polyfillHostContext);
            selector = StringWrapper.replaceAll(selector, _colonHostRe, _polyfillHost);
            return assert.returnType((selector), assert.type.string);
          },
          _propertiesFromRule: function(rule) {
            var cssText = rule.style.cssText;
            var attrRe = RegExpWrapper.create('[\'"]+|attr');
            if (rule.style.content.length > 0 && !isPresent(RegExpWrapper.firstMatch(attrRe, rule.style.content))) {
              var contentRe = RegExpWrapper.create('content:[^;]*;');
              cssText = StringWrapper.replaceAll(cssText, contentRe, 'content: \'' + rule.style.content + '\';');
            }
            return assert.returnType((cssText), assert.type.string);
          }
        }, {});
      }()));
      Object.defineProperty(ShadowCss.prototype.shimStyle, "parameters", {get: function() {
        return [[], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype.shimCssText, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._insertDirectives, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._insertPolyfillDirectivesInCssText, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._insertPolyfillRulesInCssText, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._scopeCssText, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._extractUnscopedRulesFromCssText, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._convertColonHost, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._convertColonHostContext, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._convertColonRule, "parameters", {get: function() {
        return [[assert.type.string], [RegExp], [Function]];
      }});
      Object.defineProperty(ShadowCss.prototype._colonHostContextPartReplacer, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._colonHostPartReplacer, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._convertShadowDOMSelectors, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._scopeRules, "parameters", {get: function() {
        return [[], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._scopeSelector, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string], [assert.type.boolean]];
      }});
      Object.defineProperty(ShadowCss.prototype._selectorNeedsScoping, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._makeScopeMatcher, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._applySelectorScope, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._applySimpleSelectorScope, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._applyStrictSelectorScope, "parameters", {get: function() {
        return [[assert.type.string], [assert.type.string]];
      }});
      Object.defineProperty(ShadowCss.prototype._insertPolyfillHostInCssText, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      _cssContentNextSelectorRe = RegExpWrapper.create('polyfill-next-selector[^}]*content:[\\s]*?[\'"](.*?)[\'"][;\\s]*}([^{]*?){', 'im');
      _cssContentRuleRe = RegExpWrapper.create('(polyfill-rule)[^}]*(content:[\\s]*[\'"](.*?)[\'"])[;\\s]*[^}]*}', 'im');
      _cssContentUnscopedRuleRe = RegExpWrapper.create('(polyfill-unscoped-rule)[^}]*(content:[\\s]*[\'"](.*?)[\'"])[;\\s]*[^}]*}', 'im');
      _polyfillHost = '-shadowcsshost';
      _polyfillHostContext = '-shadowcsscontext';
      _parenSuffix = ')(?:\\((' + '(?:\\([^)(]*\\)|[^)(]*)+?' + ')\\))?([^,{]*)';
      _cssColonHostRe = RegExpWrapper.create('(' + _polyfillHost + _parenSuffix, 'im');
      _cssColonHostContextRe = RegExpWrapper.create('(' + _polyfillHostContext + _parenSuffix, 'im');
      _polyfillHostNoCombinator = _polyfillHost + '-no-combinator';
      _shadowDOMSelectorsRe = [RegExpWrapper.create('>>>'), RegExpWrapper.create('::shadow'), RegExpWrapper.create('::content'), RegExpWrapper.create('/deep/'), RegExpWrapper.create('/shadow-deep/'), RegExpWrapper.create('/shadow/')];
      _selectorReSuffix = '([>\\s~+\[.,{:][\\s\\S]*)?$';
      _polyfillHostRe = RegExpWrapper.create(_polyfillHost, 'im');
      _colonHostRe = RegExpWrapper.create(':host', 'im');
      _colonHostContextRe = RegExpWrapper.create(':host-context', 'im');
      Object.defineProperty(_cssToRules, "parameters", {get: function() {
        return [[assert.type.string]];
      }});
      Object.defineProperty(_withCssRules, "parameters", {get: function() {
        return [[assert.type.string], [Function]];
      }});
    }
  };
});

System.register("angular2/src/services/xhr_impl", ["rtts_assert/rtts_assert", "angular2/di", "angular2/src/facade/async", "angular2/src/services/xhr"], function($__export) {
  "use strict";
  var __moduleName = "angular2/src/services/xhr_impl";
  var assert,
    Injectable,
    Promise,
    PromiseWrapper,
    XHR,
    XHRImpl;
  return {
    setters: [function($__m) {
      assert = $__m.assert;
    }, function($__m) {
      Injectable = $__m.Injectable;
    }, function($__m) {
      Promise = $__m.Promise;
      PromiseWrapper = $__m.PromiseWrapper;
    }, function($__m) {
      XHR = $__m.XHR;
    }],
    execute: function() {
      XHRImpl = $__export("XHRImpl", (function($__super) {
        var XHRImpl = function XHRImpl() {
          $traceurRuntime.superConstructor(XHRImpl).apply(this, arguments);
          ;
        };
        return ($traceurRuntime.createClass)(XHRImpl, {get: function(url) {
          assert.argumentTypes(url, assert.type.string);
          var completer = PromiseWrapper.completer();
          var xhr = new XMLHttp