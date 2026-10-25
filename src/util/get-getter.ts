import Reflect from "../reflection.js"
import shared from "../shared.js"

function init() {
  const { __lookupGetter__ } = Object.prototype

  function getGetter(object: object, name?: PropertyKey) {
    const useAsDescriptor = name === void 0

    if (useAsDescriptor || !shared.support.lookupShadowed) {
      const descriptor = useAsDescriptor
        ? (object as import("../reflection.js").Descriptor)
        : Reflect.getOwnPropertyDescriptor(object, name!)

      if (descriptor !== void 0) {
        return descriptor.get
      }

      if (useAsDescriptor) {
        return
      }
    }

    return __lookupGetter__.call(object, name!)
  }

  return getGetter
}

export default shared.inited ? shared.module.utilGetGetter : (shared.module.utilGetGetter = init())

export type CachedModule = ReturnType<typeof init>
