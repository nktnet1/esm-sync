import type { ModuleRecord } from "../types/runtime.js"
import type { ScriptOptions } from "node:vm"
type ReplWriter = ((value: unknown) => string) & { options: import("node:util").InspectOptions }
import Reflect from "../reflection.js"
import semver from "semver"

import COMPILER from "../constant/compiler.js"
import ENTRY from "../constant/entry.js"
import ENV from "../constant/env.js"

import CachingCompiler from "../caching-compiler.js"
import Entry from "../entry.js"
import GenericObject from "../generic/object.js"
import Loader from "../loader.js"
import Module from "../module.js"
import Package from "../package.js"
import RealModule from "../real/module.js"
import { REPLServer } from "../safe/repl.js"
import Runtime from "../runtime.js"
import Wrapper from "../wrapper.js"

import acornInternalAcorn from "../acorn/internal/acorn.js"
import acornInternalWalk from "../acorn/internal/walk.js"
import assign from "../util/assign.js"
import builtinInspect from "../builtin/inspect.js"
import builtinVM from "../builtin/vm.js"
import errors from "../errors.js"
import getCacheName from "../util/get-cache-name.js"
import getSilent from "../util/get-silent.js"
import has from "../util/has.js"
import isObject from "../util/is-object.js"
import isStackTraceMaskable from "../util/is-stack-trace-maskable.js"
import makeRequireFunction from "../module/internal/make-require-function.js"
import maskFunction from "../util/mask-function.js"
import maskStackTrace from "../error/mask-stack-trace.js"
import proxyWrap from "../util/proxy-wrap.js"
import realUtil from "../real/util.js"
import realREPL from "../real/repl.js"
import rootModule from "../root-module.js"
import setGetter from "../util/set-getter.js"
import setProperty from "../util/set-property.js"
import setPrototypeOf from "../util/set-prototype-of.js"
import setSetter from "../util/set-setter.js"
import shared from "../shared.js"
import toExternalError from "../util/to-external-error.js"
import toExternalFunction from "../util/to-external-function.js"
import wrap from "../util/wrap.js"
import safeProcess from "../safe/process.js"

const { SOURCE_TYPE_MODULE, SOURCE_TYPE_UNAMBIGUOUS } = COMPILER

const {
  STATE_EXECUTION_COMPLETED,
  STATE_EXECUTION_STARTED,
  STATE_PARSING_COMPLETED,
  STATE_PARSING_STARTED,
  TYPE_CJS,
  TYPE_ESM
} = ENTRY

const { CHECK, EVAL, FLAGS, HAS_INSPECTOR, INTERNAL, REPL } = ENV

const { ERR_INVALID_ARG_TYPE } = errors

function hook(vm: typeof import("node:vm"), programmaticREPL = false) {
  let entry: Entry
  let replEvaluationDepth = 0
  const replEntries = new WeakMap<import("node:repl").REPLServer, Entry>()

  function transpile(content: string) {
    const cacheName = getCacheName(content)
    const compileDatas = entry.package.cache.compile
    const { runtimeName } = entry

    let compileData = compileDatas.get(cacheName)

    if (compileData === void 0) {
      compileData = null
    }

    entry.state = STATE_PARSING_STARTED

    if (compileData === null) {
      const compilerOptions = {
        cjsPaths: true,
        cjsVars: true,
        generateVarDeclarations: true,
        pragmas: false,
        runtimeName,
        sourceType: SOURCE_TYPE_UNAMBIGUOUS,
        strict: false
      }

      compileData = tryWrapper(CachingCompiler.compile, [content, compilerOptions], content)
      compileDatas.set(cacheName, compileData)
    }

    entry.state = STATE_PARSING_COMPLETED

    const code =
      "(()=>{" +
      'var g=Function("return this")(),' +
      "m=g.module," +
      "e=m&&m.exports," +
      'n="' +
      runtimeName +
      '";' +
      "if(e&&!g[n]){" +
      "m.exports=e.entry.exports;" +
      "require=e.entry.require;" +
      "e.entry.addBuiltinModules(g);" +
      "Reflect.defineProperty(g,n,{" +
      "__proto__:null," +
      "value:e" +
      "})" +
      "}" +
      "})();" +
      compileData.code

    return { cacheName, code, compileData }
  }

  function managerWrapper(
    this: unknown,
    manager: typeof Function.prototype,
    func: typeof Function.prototype,
    args: unknown[]
  ) {
    const wrapped = Wrapper.find(vm, "createScript", "*")
    return Reflect.apply(wrapped!, this, [manager, func, args])
  }

  function methodWrapper(
    this: unknown,
    _manager: unknown,
    createScript: typeof vm.createScript,
    [content, scriptOptions]: [string, (string | ScriptOptions)?]
  ) {
    if (programmaticREPL && replEvaluationDepth === 0) {
      return Reflect.apply(createScript, this, [content, scriptOptions])
    }

    const options = assign({}, typeof scriptOptions === "object" ? scriptOptions : {})
    options.produceCachedData = true

    const { code, cacheName, compileData } = transpile(content)

    if (
      compileData.scriptData !== null &&
      options.produceCachedData &&
      !has(options, "cachedData")
    ) {
      options.cachedData = compileData.scriptData
    }

    const script = tryWrapper(createScript, [code, options], content, vm)

    if (script.cachedDataProduced) {
      compileData.scriptData = script.cachedData ?? null
    }

    const runInWrapper = function <A extends unknown[], R>(
      this: unknown,
      runInFunc: (...args: A) => R,
      args: A
    ): R {
      entry._validation.clear()
      entry.cacheName = cacheName
      entry.compileData = compileData
      entry.state = STATE_EXECUTION_STARTED

      entry.type = compileData.sourceType === SOURCE_TYPE_MODULE ? TYPE_ESM : TYPE_CJS

      const result = tryWrapper(runInFunc, args, content, this)

      entry.state = STATE_EXECUTION_COMPLETED

      return result
    }

    script.runInContext = wrap(script.runInContext, runInWrapper)
    script.runInThisContext = wrap(script.runInThisContext, runInWrapper)

    return script
  }

  function setupCheck() {
    vm.Script = proxyWrap(vm.Script, (Script, [code, options]) => {
      vm.Script = Script

      const wrapper = getSilent(Module, "wrapper")

      if (Array.isArray(wrapper)) {
        const prefix: unknown = wrapper[0],
          suffix: unknown = wrapper[1]

        if (typeof prefix === "string" && typeof suffix === "string") {
          code = code.slice(prefix.length, -suffix.length)
        }
      }

      setupEntry(rootModule)
      return vm.createScript(code, options)
    })
  }

  function setupEntry(mod: ModuleRecord) {
    setPrototypeOf(mod, Module.prototype)

    entry = Entry.get(mod)
    entry.addBuiltinModules = createAddBuiltinModules(entry)
    entry.package = Package.get("")
    entry.require = makeRequireFunction(mod)
    entry.runtime = null
    entry.runtimeName = shared.runtimeName

    Runtime.enable(entry, GenericObject.create())
  }

  function setupEval() {
    vm.runInThisContext = proxyWrap(
      vm.runInThisContext,
      (runInThisContext, [code, options]): unknown => {
        vm.runInThisContext = runInThisContext
        setupEntry(shared.unsafeGlobal.module as unknown as ModuleRecord)
        return vm
          .createScript(code, options)
          .runInThisContext(typeof options === "string" ? void 0 : options)
      }
    )

    RealModule.prototype._compile = Module.prototype._compile
  }

  function setupREPL() {
    const { createContext } = REPLServer.prototype

    if (rootModule.id === "<repl>") {
      setupEntry(rootModule)
    } else if (typeof createContext === "function") {
      REPLServer.prototype.createContext = proxyWrap(
        createContext,
        function (this: import("node:repl").REPLServer) {
          if (!programmaticREPL) {
            REPLServer.prototype.createContext = createContext
          }

          const server = this
          const originalEval = server.eval

          if (
            semver.gte(safeProcess.versions.node, "18.0.0") &&
            (!programmaticREPL || !replEntries.has(server))
          ) {
            ;(server as { eval: typeof originalEval }).eval = function (
              cmd,
              context,
              filename,
              callback
            ) {
              if (programmaticREPL) {
                entry = replEntries.get(this)!
                replEvaluationDepth++
              }
              try {
                try {
                  const { code } = transpile(cmd)
                  return originalEval.call(this, code, context, filename, callback)
                } catch (_e) {
                  return originalEval.call(this, cmd, context, filename, callback)
                }
              } finally {
                if (programmaticREPL) replEvaluationDepth--
              }
            }
          }

          Reflect.defineProperty(this, "writer", {
            configurable: true,
            enumerable: true,
            get() {
              return void 0
            },
            set(this: import("node:repl").REPLServer, value: ReplWriter) {
              const writer = maskFunction((object: unknown) => {
                return builtinInspect(object, writer.options)
              }, value) as ReplWriter

              writer.options = value.options
              writer.options.colors = this.useColors

              Reflect.defineProperty(builtinInspect, "replDefaults", {
                configurable: true,
                enumerable: true,
                get() {
                  return writer.options
                },
                set(options: unknown) {
                  if (!isObject(options)) {
                    throw new ERR_INVALID_ARG_TYPE("options", "Object", options)
                  }

                  assign(writer.options, options)
                }
              })

              setProperty(this, "writer", writer)
              setProperty(realREPL, "writer", writer)

              // return writer
            }
          })

          const context = Reflect.apply(createContext, this, [])

          let mod = context.module

          Reflect.defineProperty(shared.unsafeGlobal, "module", {
            configurable: true,
            get() {
              return mod
            },
            set(value: ModuleRecord) {
              mod = value
              setupEntry(mod)
            }
          })

          setupEntry(mod)
          if (programmaticREPL) replEntries.set(server, entry)
          return context
        }
      )
    }

    builtinVM.createScript = vm.createScript

    if (INTERNAL && FLAGS.experimentalREPLAwait) {
      acornInternalAcorn.enable()
      acornInternalWalk.enable()
    }

    // Exit for Node 10+.
    if (shared.support.replShowProxy) {
      setProperty(realUtil, "inspect", builtinInspect)
      return
    }

    const _inspect = realUtil.inspect

    setGetter(
      realUtil,
      "inspect",
      toExternalFunction(function (this: typeof realUtil) {
        // Prevent re-entering the getter by triggering the setter to convert
        // `util.inspect()` from an accessor property to a data property.
        this.inspect = builtinInspect

        // The first getter call occurs in Node's lib/repl.js as an assignment
        // to `repl.writer()`. It needs to be the original `util.inspect()`
        // for ANSI coloring to be enabled.
        // https://github.com/nodejs/node/blob/v9.11.1/lib/repl.js#L377-L382
        return _inspect
      })
    )

    setSetter(
      realUtil,
      "inspect",
      toExternalFunction(function (this: object, value: unknown) {
        setProperty(this, "inspect", value)
      })
    )
  }

  Wrapper.manage(vm, "createScript", managerWrapper)
  Wrapper.wrap(vm, "createScript", methodWrapper)

  if (CHECK) {
    setupCheck()
  } else if (EVAL) {
    setupEval()
  } else if (REPL || programmaticREPL) {
    setupREPL()
  }
}

function createAddBuiltinModules(entry: Entry) {
  const lazyModules = [
    "assert",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "crypto",
    "dgram",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "http2",
    "https",
    "net",
    "os",
    "path",
    "perf_hooks",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "stream",
    "string_decoder",
    "tls",
    "tty",
    "url",
    "util",
    "v8",
    "vm",
    "zlib"
  ]

  const { length } = lazyModules

  if (HAS_INSPECTOR) {
    lazyModules.push("inspector")
  }

  if (FLAGS.experimentalWorker) {
    lazyModules.push("worker_threads")
  }

  if (lazyModules.length !== length) {
    lazyModules.sort()
  }

  return function addBuiltinModules(context: Record<PropertyKey, unknown>) {
    const req = entry.require!

    exposeObject(context, "console", req("console"))
    exposeObject(context, "process", req("process"))

    for (const name of lazyModules) {
      const set = toExternalFunction(function (this: object, value: unknown) {
        Reflect.defineProperty(this, name, {
          configurable: true,
          value,
          writable: true
        })
      })

      Reflect.defineProperty(context, name, {
        configurable: true,
        get: toExternalFunction(function (this: Record<PropertyKey, unknown>) {
          // Prevent re-entering the getter by triggering the setter to convert
          // `context[name]` from an accessor property to a data property.
          this[name] = void 0

          const exported = req(name)

          Reflect.defineProperty(this, name, {
            configurable: true,
            get: () => exported,
            set
          })

          return exported
        }),
        set
      })
    }
  }
}

function exposeObject(context: object, name: PropertyKey, value: unknown) {
  // Objects exposed on the global object must have the property attributes
  // { [[Configurable]]: true, [[Enumerable]]: false, [[Writable]]: true }.
  // https://heycam.github.io/webidl/#es-namespaces
  Reflect.defineProperty(context, name, {
    configurable: true,
    value,
    writable: true
  })
}

function tryWrapper<A extends unknown[], R>(
  func: (...args: A) => R,
  args: A,
  content: string,
  thisArg?: unknown
): R {
  let error: unknown

  try {
    return Reflect.apply(func, thisArg, args)
  } catch (e) {
    error = e
  }

  if (!Loader.state.package.default!.options.debug && isStackTraceMaskable(error)) {
    maskStackTrace(error, { content })
  } else {
    toExternalError(error)
  }

  throw error
}

export default hook
