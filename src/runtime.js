import ENTRY from "./constant/entry.js"

import CachingCompiler from "./caching-compiler.js"
import Loader from "./loader.js"

import builtinGlobal from "./builtin/global.js"
import errors from "./errors.js"
import esmImport from "./module/esm/import.js"
import esmLoad from "./module/esm/load.js"
import getURLFromFilePath from "./util/get-url-from-file-path.js"
import has from "./util/has.js"
import { readFileSync } from "./safe/fs.js"
import hasPragma from "./parse/has-pragma.js"
import identity from "./util/identity.js"
import isFileOrigin from "./util/is-file-origin.js"
import isPath from "./util/is-path.js"
import isStackTraceMaskable from "./util/is-stack-trace-maskable.js"
import makeRequireFunction from "./module/internal/make-require-function.js"
import maskStackTrace from "./error/mask-stack-trace.js"
import setDeferred from "./util/set-deferred.js"
import { setImmediate } from "./safe/timers.js"
import shared from "./shared.js"
import toExternalError from "./util/to-external-error.js"
import toExternalFunction from "./util/to-external-function.js"

const {
  ERROR_GETTER,
  ERROR_STAR,
  GETTER_TYPE_STAR_CONFLICT,
  LOAD_COMPLETED,
  NAMESPACE_FINALIZATION_DEFERRED,
  SETTER_TYPE_DYNAMIC_IMPORT,
  SETTER_TYPE_EXPORT_FROM,
  SETTER_TYPE_NAMESPACE,
  TYPE_CJS,
  TYPE_ESM,
  TYPE_PSEUDO,
  UPDATE_TYPE_LIVE
} = ENTRY

const { ERR_CONST_ASSIGNMENT, ERR_UNDEFINED_IDENTIFIER } = errors

const {
  Promise: ExPromise,
  SyntaxError: ExSyntaxError,
  TypeError: ExTypeError,
  eval: evalIndirect
} = shared.external

// Terser can rewrite template-string coercion as `value + ""`, which uses
// the wrong ToPrimitive hint. Retain String as a callable intrinsic instead.
const ImportString = String

function validateDynamicImportOptions(options) {
  if (options === void 0) {
    return
  }

  if (options === null || (typeof options !== "object" && typeof options !== "function")) {
    throw new ExTypeError("Dynamic import options must be an object")
  }

  const attributes = options.with

  if (attributes === void 0) {
    return
  }

  if (attributes === null || (typeof attributes !== "object" && typeof attributes !== "function")) {
    throw new ExTypeError("Dynamic import attributes must be an object")
  }

  // EnumerableOwnProperties collects string keys before looking up their
  // values. In particular, ignore symbols and non-enumerable properties.
  let moduleType

  for (const key of Object.keys(attributes)) {
    const value = attributes[key]

    if (typeof value !== "string") {
      throw new ExTypeError("Dynamic import attribute values must be strings")
    }

    if (key === "type") {
      moduleType = value
    }
  }

  return moduleType
}

function isCyclicStarReExport(getter, entry, exportedName) {
  const seen = new Set()

  while (getter !== void 0 && getter.deferred && !seen.has(getter)) {
    seen.add(getter)

    if (getter.owner === entry && getter.id === exportedName) {
      return true
    }

    getter = getter.owner.getters[getter.id]
  }

  return false
}

const Runtime = {
  addDefaultValue(value) {
    this.addExportGetters([["default", () => value]])

    if (value === void 0) {
      this.initBindings(["default"])
    }
  },
  addExportFromSetter(importedName, exportedName = importedName, preserveGetter = false) {
    const setter = createAccessor(SETTER_TYPE_EXPORT_FROM, (_value, childEntry) => {
      const { entry } = this

      if (entry._loaded === LOAD_COMPLETED) {
        return true
      }

      if (childEntry.type === TYPE_CJS && childEntry._loaded !== LOAD_COMPLETED) {
        entry._namespaceFinalized = NAMESPACE_FINALIZATION_DEFERRED
      }

      if (preserveGetter) {
        // A namespace imported and exported through a local binding has the
        // same identity as `export * as`, but its getter must keep observing
        // the local value for CommonJS interception and mocking.
        const getter = entry.getters[exportedName]

        if (getter !== void 0) {
          getter.owner = childEntry
          getter.id = importedName
        }
      } else {
        entry.addGetterFrom(childEntry, importedName, exportedName)
      }
    })

    setter.exportedName = exportedName

    return setter
  },
  addExportGetters(getterArgsList) {
    this.entry.addGetters(getterArgsList)
  },
  addNamespaceSetter() {
    return createAccessor(SETTER_TYPE_NAMESPACE, (_value, childEntry) => {
      const { entry } = this

      if (entry._loaded === LOAD_COMPLETED) {
        return true
      }

      const childIsLoaded = childEntry._loaded === LOAD_COMPLETED

      if (!childIsLoaded && childEntry.type === TYPE_CJS) {
        entry._namespaceFinalized = NAMESPACE_FINALIZATION_DEFERRED
        return
      }

      const childGetters = childEntry.getters
      const { getters } = entry

      const namespace = childIsLoaded ? childEntry.getExportByName("*", entry) : childEntry.getters

      for (const exportedName in namespace) {
        if (exportedName === "default") {
          continue
        }

        const getter = getters[exportedName]
        const childGetter = childGetters[exportedName]

        // ResolveExport discards indirect re-exports that return to the same
        // module and export name. They cannot independently provide a binding.
        if (isCyclicStarReExport(childGetter, entry, exportedName)) {
          continue
        }

        // A star export is ambiguous only if the original module or binding
        // differs. Explicit exports still take precedence over star exports.
        if (getter !== void 0 && getter.owner === entry) {
          continue
        }

        if (
          getter === void 0 ||
          (getter.owner === childGetter.owner && getter.id === childGetter.id)
        ) {
          entry.addGetterFrom(childEntry, exportedName)
        } else {
          entry.addGetter(
            exportedName,
            createAccessor(GETTER_TYPE_STAR_CONFLICT, () => ERROR_STAR)
          )
        }
      }
    })
  },
  assertImportedBinding: function assertImportedBinding(name, value) {
    if (this.entry.importedBindings.get(name) !== true) {
      throw new ERR_UNDEFINED_IDENTIFIER(name, assertImportedBinding)
    }

    return value
  },
  assertUndeclared: function assertUndeclared(name) {
    const { unsafeGlobal } = shared

    if (!has(unsafeGlobal, name)) {
      throw new ERR_UNDEFINED_IDENTIFIER(name, assertUndeclared)
    }

    return unsafeGlobal[name]
  },
  compileEval(content) {
    // Section 18.2.1.1: PerformEval()
    // Step 2: Only evaluate strings.
    // https://tc39.github.io/ecma262/#sec-performeval
    if (typeof content !== "string") {
      return content
    }

    const { entry } = this
    const { cjs } = entry.package.options
    const isMJS = entry.extname === ".mjs"

    const cjsVars = cjs.vars && !isMJS

    try {
      return CachingCompiler.compile(content, {
        cjsVars,
        eval: true,
        runtimeName: entry.runtimeName
      }).code
    } catch (e) {
      if (!Loader.state.package.default.options.debug && isStackTraceMaskable(e)) {
        const { type } = entry

        maskStackTrace(e, {
          content,
          filename: "eval",
          inModule: (!cjs.paths || isMJS) && type !== TYPE_CJS && type !== TYPE_PSEUDO
        })
      } else {
        toExternalError(e)
      }

      throw e
    }
  },
  compileGlobalEval(content) {
    if (typeof content !== "string") {
      return content
    }

    const { entry } = this
    const { cjs } = entry.package.options
    const isMJS = entry.extname === ".mjs"
    const { runtimeName } = entry

    const cjsVars = cjs.vars && !isMJS

    let code

    try {
      const compileData = CachingCompiler.compile(content, {
        cjsVars,
        eval: true,
        runtimeName
      })

      if (compileData.transforms === 0) {
        return content
      }

      code = compileData.code
    } catch (e) {
      if (!Loader.state.package.default.options.debug && isStackTraceMaskable(e)) {
        const { type } = entry

        maskStackTrace(e, {
          content,
          filename: "eval",
          inModule: (!cjs.paths || isMJS) && type !== TYPE_CJS && type !== TYPE_PSEUDO
        })
      } else {
        toExternalError(e)
      }

      throw e
    }

    const { unsafeGlobal } = shared

    if (has(unsafeGlobal, runtimeName)) {
      return code
    }

    const runtime = this

    Reflect.defineProperty(unsafeGlobal, runtimeName, {
      configurable: true,
      get: toExternalFunction(function () {
        Reflect.deleteProperty(this, runtimeName)
        return runtime
      })
    })

    code =
      (hasPragma(code, "use strict") ? '"use strict";' : "") +
      "let " +
      runtimeName +
      "=global." +
      runtimeName +
      ";" +
      code

    return code
  },
  importDeferred(request, setterArgsList) {
    const parentEntry = this.entry
    const { moduleState } = shared
    const previousParsing = moduleState.parsing
    const previousChildren = new Set(Object.values(parentEntry.children))
    let childEntry

    // Link and validate exports without starting the module body. The
    // loader already supports this split for cyclic module dependencies.
    moduleState.parsing = true
    try {
      childEntry = esmLoad(request, parentEntry.module, false)
    } finally {
      moduleState.parsing = previousParsing
    }

    // The normal CJS fallback postpones parsing untransformed scripts until
    // execution. Deferred module requests still require link-time syntax
    // errors, so validate those scripts without running their bodies.
    if (childEntry.type === TYPE_CJS && typeof childEntry.filename === "string") {
      new Function(readFileSync(childEntry.filename, "utf8"))
    }

    // A deferred child must not be resumed by the parent's regular eager
    // dependency traversal. It is evaluated on its first export operation.
    if (!previousChildren.has(childEntry) && parentEntry.children[childEntry.name] === childEntry) {
      delete parentEntry.children[childEntry.name]
    }

    let namespace = childEntry.deferredNamespace
    if (namespace === void 0) {
      const eagerNamespace = childEntry.completeNamespace
      const target = Object.create(null)
      let started = false
      let failure

      // A deferred namespace is distinct from the ordinary namespace and
      // has its own non-configurable @@toStringTag. Proxying the ordinary
      // namespace directly would violate Proxy invariants for that property.
      for (const name of Object.keys(childEntry.getters).sort()) {
        Object.defineProperty(target, name, {
          configurable: false,
          enumerable: true,
          writable: true,
          value: void 0
        })
      }
      Object.defineProperty(target, Symbol.toStringTag, { value: "Deferred Module" })
      Object.preventExtensions(target)

      const ensureEvaluated = () => {
        if (failure !== void 0) throw failure
        if (started) return
        started = true
        try {
          esmLoad(request, parentEntry.module, false)
        } catch (error) {
          failure = error
          throw error
        }
      }

      // Ordinary export-key operations trigger synchronous evaluation.
      // Avoid promise thenable assimilation for deferred namespaces.
      const shouldEvaluate = (name) => typeof name === "string" && name !== "then"
      namespace = new Proxy(target, {
        get(target, name) {
          if (shouldEvaluate(name)) {
            ensureEvaluated()
            return Reflect.get(eagerNamespace, name)
          }
          return Reflect.get(target, name)
        },
        getOwnPropertyDescriptor(target, name) {
          if (shouldEvaluate(name)) {
            ensureEvaluated()
            const descriptor = Reflect.getOwnPropertyDescriptor(target, name)
            if (descriptor !== void 0) {
              descriptor.value = Reflect.get(eagerNamespace, name)
            }
            return descriptor
          }
          return Reflect.getOwnPropertyDescriptor(target, name)
        },
        has(target, name) {
          if (shouldEvaluate(name)) ensureEvaluated()
          return Reflect.has(target, name)
        },
        ownKeys(target) {
          ensureEvaluated()
          return Reflect.ownKeys(target)
        },
        defineProperty(_target, name) {
          if (shouldEvaluate(name)) ensureEvaluated()
          return false
        },
        deleteProperty(target, name) {
          if (shouldEvaluate(name)) ensureEvaluated()
          return Reflect.deleteProperty(target, name)
        },
        set() {
          return false
        }
      })
      childEntry.deferredNamespace = namespace
    }
    for (const [, , setter] of setterArgsList) {
      setter(namespace, childEntry)
    }
  },
  dynamicSourceImport(request, options) {
    return Runtime.dynamicImport.call(this, request, options, "source")
  },
  dynamicDeferImport(request, options) {
    return Runtime.dynamicImport.call(this, request, options, "defer")
  },
  dynamicImport(request, options, phase = "evaluation") {
    const { entry } = this

    return new ExPromise((resolvePromise, rejectPromise) => {
      let moduleType
      // EvaluateImportCall converts the specifier and processes import
      // attributes before returning its promise. Errors reject the promise
      // through its executor instead of escaping from import().
      try {
        if (typeof request !== "string") {
          if (typeof request === "symbol") {
            throw new ExTypeError("Cannot convert a Symbol value to a string")
          }

          request = ImportString(request)
        }

        moduleType = validateDynamicImportOptions(options)
      } catch (error) {
        // A failed ToString can originate inside the bundled runtime. Expose
        // the caller's error constructors without replacing a thrown value.
        toExternalError(error)
        rejectPromise(error)
        return
      }

      setImmediate(() => {
        try {
          // This loader has no JavaScript ModuleSource representation, so
          // source-phase imports reject with SyntaxError (as permitted by the
          // Source Phase Imports host contract). Deferred module evaluation
          // requires a linked-but-unevaluated module graph: do not fall back
          // to eager import(), which would run side effects prematurely.
          if (phase === "defer") {
            let namespace
            Runtime.importDeferred.call(this, request, [
              [
                "*",
                null,
                (value) => {
                  namespace = value
                }
              ]
            ])
            resolvePromise(namespace)
            return
          }
          if (phase === "source") {
            throw new ExSyntaxError("Module source phase is unavailable")
          }

          let lastValue
          let timerId

          const setterArgsList = [
            [
              "*",
              null,
              createAccessor(SETTER_TYPE_DYNAMIC_IMPORT, (value, childEntry) => {
                if (childEntry._loaded === LOAD_COMPLETED) {
                  lastValue = value

                  if (timerId === void 0) {
                    timerId = setImmediate(() => resolvePromise(lastValue))
                  }

                  return true
                }
              })
            ]
          ]

          esmImport(request, entry, setterArgsList, true, moduleType)
        } catch (e) {
          if (!Loader.state.package.default.options.debug && isStackTraceMaskable(e)) {
            maskStackTrace(e, {
              inModule: !entry.package.options.cjs.paths || entry.extname === ".mjs"
            })
          } else {
            toExternalError(e)
          }

          rejectPromise(e)
        }
      })
    })
  },
  enable(entry, exported) {
    if (entry.runtime !== null) {
      return entry.runtime
    }

    const mod = entry.module
    const runtime = mod.exports

    const boundCompileEval = (code) => Runtime.compileEval.call(runtime, code)
    const boundGlobalEval = (code) => Runtime.globalEval.call(runtime, code)

    entry.exports = exported

    setDeferred(runtime, "meta", () => {
      const { id } = entry

      let url = null

      if (isFileOrigin(id)) {
        url = id
      } else if (isPath(id)) {
        url = getURLFromFilePath(id)
      }

      return {
        __proto__: null,
        url
      }
    })

    runtime.addDefaultValue = Runtime.addDefaultValue
    runtime.addExportFromSetter = Runtime.addExportFromSetter
    runtime.addExportGetters = Runtime.addExportGetters
    runtime.addNamespaceSetter = Runtime.addNamespaceSetter
    runtime.assertImportedBinding = Runtime.assertImportedBinding
    runtime.assertUndeclared = Runtime.assertUndeclared
    runtime.compileEval = boundCompileEval
    runtime.compileGlobalEval = Runtime.compileGlobalEval
    runtime.dynamicImport = Runtime.dynamicImport
    runtime.dynamicSourceImport = Runtime.dynamicSourceImport
    runtime.dynamicDeferImport = Runtime.dynamicDeferImport
    runtime.entry = entry
    runtime.global = builtinGlobal
    runtime.globalEval = boundGlobalEval
    runtime.import = Runtime.import
    runtime.importDeferred = Runtime.importDeferred
    runtime.initBindings = Runtime.initBindings
    runtime.resumeChildren = Runtime.resumeChildren
    runtime.run = Runtime.run
    runtime.runResult = void 0
    runtime.throwConstAssignment = Runtime.throwConstAssignment
    runtime.updateBindings = Runtime.updateBindings

    runtime._ = runtime
    runtime.a = runtime.assertImportedBinding
    runtime.b = runtime.throwConstAssignment
    runtime.c = runtime.compileEval
    runtime.d = runtime.addDefaultValue
    runtime.e = runtime.globalEval
    runtime.f = runtime.addExportFromSetter
    runtime.g = runtime.global
    runtime.i = runtime.dynamicImport
    runtime.j = runtime.initBindings
    runtime.k = identity
    runtime.n = runtime.addNamespaceSetter
    runtime.o = ERROR_GETTER
    runtime.p = runtime.dynamicSourceImport
    runtime.q = runtime.dynamicDeferImport
    runtime.r = runtime.run
    runtime.s = runtime.resumeChildren
    runtime.t = runtime.assertUndeclared
    runtime.u = runtime.updateBindings
    runtime.v = evalIndirect
    runtime.w = runtime.import
    runtime.x = runtime.addExportGetters
    runtime.y = runtime.importDeferred

    return (entry.runtime = runtime)
  },
  globalEval(content) {
    return evalIndirect(this.compileGlobalEval(content))
  },
  import(request, setterArgsList, moduleType) {
    return esmImport(request, this.entry, setterArgsList, false, moduleType)
  },
  initBindings(names) {
    this.entry.updateBindings(names)
  },
  resumeChildren() {
    this.entry.resumeChildren()
  },
  run(moduleWrapper) {
    const { entry } = this

    const runner = entry.type === TYPE_ESM ? runESM : runCJS

    return (this.runResult = runner(entry, moduleWrapper))
  },
  throwConstAssignment: function throwConstAssignment() {
    throw new ERR_CONST_ASSIGNMENT(throwConstAssignment)
  },
  updateBindings(valueToPassThrough) {
    this.entry.updateBindings(null, UPDATE_TYPE_LIVE)

    // Returns the `valueToPassThrough()` parameter to allow the value of the
    // original expression to pass through. For example,
    //
    //   export let a = 1
    //   a += 3
    //
    // becomes
    //
    //   runtime.addExportGetters([["a", () => a]])
    //   let a = 1
    //   runtime.updateBindings(a += 3)
    //
    // This ensures `entry.updateBindings()` runs immediately after assignment,
    // without interfering with the larger computation.
    return valueToPassThrough
  }
}

function createAccessor(type, accessor) {
  accessor.type = type

  return accessor
}

function runCJS(entry, moduleWrapper) {
  const mod = entry.module
  const exported = entry.exports

  mod.exports = exported

  return Reflect.apply(moduleWrapper, exported, [exported, makeRequireFunction(mod)])
}

function runESM(entry, moduleWrapper) {
  const mod = entry.module
  const exported = entry.exports

  mod.exports = exported

  if (entry.package.options.cjs.vars && entry.extname !== ".mjs") {
    return Reflect.apply(moduleWrapper, exported, [exported, makeRequireFunction(mod)])
  }

  return Reflect.apply(moduleWrapper, void 0, [])
}

export default Runtime
