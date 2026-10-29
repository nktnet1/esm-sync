import type { Descriptor } from "../reflection.js"
import Reflect from "../reflection.js"
import { Script } from "../safe/vm.js"

import allKeys from "./all-keys.js"
import { deprecate } from "../safe/util.js"
import getPrototypeOf from "./get-prototype-of.js"
import has from "./has.js"
import instanceOf from "./instance-of.js"
import isObjectLike from "./is-object-like.js"
import setPrototypeOf from "./set-prototype-of.js"
import shared from "../shared.js"

function init() {
  const possibleBuiltins = [
    "Array",
    "ArrayBuffer",
    "Atomics",
    "BigInt",
    "BigInt64Array",
    "BigUint64Array",
    "Boolean",
    "DataView",
    "Date",
    "Error",
    "eval",
    "EvalError",
    "Float32Array",
    "Float64Array",
    "Function",
    "Int16Array",
    "Int32Array",
    "Int8Array",
    "Map",
    "Number",
    "Object",
    "Promise",
    "Proxy",
    "RangeError",
    "ReferenceError",
    "Reflect",
    "RegExp",
    "Set",
    "SharedArrayBuffer",
    "String",
    "Symbol",
    "SyntaxError",
    "TypeError",
    "URIError",
    "Uint16Array",
    "Uint32Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "WeakMap",
    "WeakSet"
  ]

  const reassignableBuiltins = [
    "Buffer",
    "URL",
    "URLSearchParams",
    "clearImmediate",
    "clearInterval",
    "clearTimeout",
    "console",
    "global",
    "process",
    "setImmediate",
    "setInterval",
    "setTimeout"
  ]

  function prepareContext<T extends object>(context: T): T {
    const { defaultGlobal } = shared

    if (context === defaultGlobal) {
      return context
    }

    // An already-contextified global (e.g. Jest's sandbox) has its own realm.
    // Node's lazy globals cannot safely be transplanted into it: even reading
    // their descriptors can abort Node, and copied getters reject the receiver.
    const isExistingContext = shared.module.safeVM.isContext(shared.unsafeGlobal)
    const unsafeGlobalNames = ["DOMException", "performance", "crypto", "navigator"]
    const names = allKeys(defaultGlobal)

    for (const name of names) {
      let descriptor: Descriptor | undefined

      if (name === "global") {
        descriptor = {
          configurable: true,
          enumerable: true,
          value: context,
          writable: true
        }
      } else if (name === "GLOBAL" || name === "root") {
        descriptor = getDeprecatedGlobalDescriptor(name, context)
      } else if (
        isExistingContext &&
        typeof name === "string" &&
        unsafeGlobalNames.includes(name)
      ) {
        continue
      } else if (!has(context, name)) {
        descriptor = Reflect.getOwnPropertyDescriptor(defaultGlobal, name)
      }

      if (descriptor !== void 0) {
        Reflect.defineProperty(context, name, descriptor)
      }
    }

    // For an unknown reason some `context` properties aren't accessible as
    // free global variables unless they're deleted and reassigned.
    for (const name of reassignableBuiltins) {
      const descriptor: Descriptor | undefined = Reflect.getOwnPropertyDescriptor(context, name)

      if (descriptor !== void 0 && Reflect.deleteProperty(context, name)) {
        Reflect.defineProperty(context, name, descriptor)
      }
    }

    const descriptors = new Map<string, Descriptor>()

    for (const name of possibleBuiltins) {
      if (has(context, name)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(context, name)!
        if (
          name === "eval" &&
          (typeof descriptor.value !== "function" ||
            Function.prototype.toString.call(descriptor.value) !==
              "function eval() { [native code] }")
        ) {
          continue
        }
        descriptors.set(name, descriptor)

        // Delete shadowed builtins to expose those of its realm.
        Reflect.deleteProperty(context, name)
      }
    }

    if (descriptors.size === 0) {
      return context
    }

    const realmBuiltins: unknown = new Script(
      "({" +
        (() => {
          const names = descriptors.keys()

          let status: IteratorResult<string, undefined>
          let code = ""

          do {
            status = names.next()

            code += toBuiltinPropertySnippet(status.value) + (status.done ? "" : ",")
          } while (!status.done)

          return code
        })() +
        "})"
    ).runInContext(context)

    descriptors.forEach((descriptor, name) => {
      // Direct eval only retains the caller's lexical scope when it is the
      // intrinsic eval of the executing realm. A copied Jest/host eval turns
      // protobufjs' eval("require") into an indirect, global evaluation.
      if (name === "eval") {
        Reflect.defineProperty(context, name, {
          configurable: true,
          value: Reflect.get(realmBuiltins as object, name),
          writable: true
        })
        return
      }
      Reflect.defineProperty(context, name, descriptor)

      const Builtin: unknown = Reflect.get(context, name)
      const RealmBuiltin: unknown = Reflect.get(realmBuiltins as object, name)

      if (Builtin === RealmBuiltin || !isObjectLike(Builtin) || !isObjectLike(RealmBuiltin)) {
        return
      }

      if (name === "Error") {
        RealmBuiltin.prepareStackTrace = (...args: unknown[]) =>
          Reflect.apply(Builtin.prepareStackTrace as typeof Function.prototype, Builtin, args)
      } else if (name === "Object") {
        Reflect.defineProperty(Builtin, Symbol.hasInstance, {
          configurable: true,
          value: function (this: unknown, instance: unknown) {
            if (this === Builtin) {
              return (
                instance instanceof (RealmBuiltin as unknown as typeof Function.prototype) ||
                instanceOf(instance, Builtin)
              )
            }

            return instanceOf(instance, this)
          }
        })
      }

      if (typeof RealmBuiltin === "function") {
        setPrototypeOf(RealmBuiltin, getPrototypeOf(Builtin))

        if (has(RealmBuiltin, "prototype")) {
          const RealmProto: unknown = Reflect.get(RealmBuiltin, "prototype")

          if (isObjectLike(RealmProto)) {
            const BuiltinProto: unknown = Reflect.get(Builtin, "prototype")

            setPrototypeOf(RealmProto, BuiltinProto)

            if (has(BuiltinProto, "constructor")) {
              Reflect.defineProperty(
                RealmProto,
                "constructor",
                Reflect.getOwnPropertyDescriptor(BuiltinProto as object, "constructor")!
              )
            }
          }
        }
      }
    })

    return context
  }

  function getDeprecatedGlobalDescriptor(name: string, context: object): Descriptor {
    const depCode = "DEP0016"
    const depMessage = "'" + name + "' is deprecated, use 'global'"

    return {
      configurable: true,
      get: deprecate(() => context, depMessage, depCode),
      set: deprecate(
        function (this: object, value: unknown) {
          Reflect.defineProperty(this, name, {
            configurable: true,
            value,
            writable: true
          })
        },
        depMessage,
        depCode
      )
    }
  }

  function toBuiltinPropertySnippet(name: string | undefined) {
    let snippet = name + ":"

    if (name === "Array") {
      snippet += "[].constructor"
    } else if (name === "BigInt") {
      snippet += "1n.constructor"
    } else if (name === "Boolean") {
      snippet += "true.constructor"
    } else if (name === "Function") {
      snippet += "(function () {}).constructor"
    } else if (name === "Number") {
      snippet += "1..constructor"
    } else if (name === "Object") {
      snippet += "({}).constructor"
    } else if (name === "RegExp") {
      snippet += "/./.constructor"
    } else if (name === "String") {
      snippet += '"".constructor'
    } else {
      snippet += "this." + name
    }

    return snippet
  }

  return prepareContext
}

export default shared.inited
  ? shared.module.utilPrepareContext
  : (shared.module.utilPrepareContext = init())

export type CachedModule = ReturnType<typeof init>
