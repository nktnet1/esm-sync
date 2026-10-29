import Reflect from "../reflection.js"
import OwnProxy from "../own/proxy.js"

import isModuleNamespaceObject from "../util/is-module-namespace-object.js"
import isUpdatableDescriptor from "../util/is-updatable-descriptor.js"
import isUpdatableGet from "../util/is-updatable-get.js"
import maskFunction from "../util/mask-function.js"
import shared from "../shared.js"

function init() {
  const ExReflect = shared.external.Reflect

  function wrapBuiltin(builtinFunc: typeof Function.prototype) {
    return maskFunction(function (this: unknown, ...args: unknown[]) {
      const [target] = args

      try {
        return Reflect.apply(builtinFunc, this, args)
      } catch (e) {
        if (isModuleNamespaceObject(target)) {
          return false
        }

        throw e
      }
    }, builtinFunc)
  }

  const wrappers = new Map<
    PropertyKey,
    { original: unknown; wrapped: ReturnType<typeof wrapBuiltin> }
  >()

  for (const name of ["defineProperty", "deleteProperty", "set"]) {
    const original = Reflect.get(ExReflect, name)

    if (typeof original === "function") {
      wrappers.set(name, { original, wrapped: wrapBuiltin(original) })
    }
  }

  // Keep polyfill additions, replacements, and deletions shared with CJS.
  // Only substitute the original mutators while their descriptors permit it;
  // frozen properties must retain their exact values to satisfy Proxy invariants.
  const BuiltinReflect = new OwnProxy(ExReflect, {
    get(target, name, receiver) {
      if (receiver === BuiltinReflect) receiver = target

      const value = Reflect.get(target, name, receiver)
      const wrapper = wrappers.get(name)

      return wrapper !== void 0 && value === wrapper.original && isUpdatableGet(target, name)
        ? wrapper.wrapped
        : value
    },
    set(target, name, value, receiver) {
      if (receiver === BuiltinReflect) receiver = target

      return Reflect.set(target, name, value, receiver)
    },
    getOwnPropertyDescriptor(target, name) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, name)
      const wrapper = wrappers.get(name)

      if (
        wrapper !== void 0 &&
        isUpdatableDescriptor(descriptor) &&
        descriptor.value === wrapper.original
      ) {
        descriptor.value = wrapper.wrapped
      }

      return descriptor
    }
  })

  return BuiltinReflect
}

export default shared.inited
  ? shared.module.builtinReflect
  : (shared.module.builtinReflect = init())

export type CachedModule = ReturnType<typeof init>
