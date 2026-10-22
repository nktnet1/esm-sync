import ENTRY from "./constant/entry.js"

import CachingCompiler from "./caching-compiler.js"
import Loader from "./loader.js"

import builtinGlobal from "./builtin/global.js"
import errors from "./errors.js"
import esmImport from "./module/esm/import.js"
import getURLFromFilePath from "./util/get-url-from-file-path.js"
import has from "./util/has.js"
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

const { Promise: ExPromise, TypeError: ExTypeError, eval: evalIndirect } = shared.external

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
  for (const key of Object.keys(attributes)) {
    if (typeof attributes[key] !== "string") {
      throw new ExTypeError("Dynamic import attribute values must be strings")
    }
  }
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
  dynamicImport(request, options) {
    const { entry } = this

    return new ExPromise((resolvePromise, rejectPromise) => {
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

        validateDynamicImportOptions(options)
      } catch (error) {
        // A failed ToString can originate inside the bundled runtime. Expose
        // the caller's error constructors without replacing a thrown value.
        toExternalError(error)
        rejectPromise(error)
        return
      }

      setImmediate(() => {
        try {
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

          esmImport(request, entry, setterArgsList, true)
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
    runtime.entry = entry
    runtime.global = builtinGlobal
    runtime.globalEval = boundGlobalEval
    runtime.import = Runtime.import
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
    runtime.r = runtime.run
    runtime.s = runtime.resumeChildren
    runtime.t = runtime.assertUndeclared
    runtime.u = runtime.updateBindings
    runtime.v = evalIndirect
    runtime.w = runtime.import
    runtime.x = runtime.addExportGetters

    return (entry.runtime = runtime)
  },
  globalEval(content) {
    return evalIndirect(this.compileGlobalEval(content))
  },
  import(request, setterArgsList) {
    return esmImport(request, this.entry, setterArgsList)
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
