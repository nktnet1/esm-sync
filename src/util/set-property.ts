import Reflect from "../reflection.js"
import isObjectLike from "./is-object-like.js"
import shared from "../shared.js"

function init() {
  const dataDescriptor = {
    configurable: true,
    enumerable: true,
    value: void 0 as unknown,
    writable: true
  }

  function setProperty(object: unknown, name: PropertyKey, value: unknown) {
    if (isObjectLike(object)) {
      dataDescriptor.value = value

      return Reflect.defineProperty(object, name, dataDescriptor)
    }

    return false
  }

  return setProperty
}

export default shared.inited
  ? shared.module.utilSetProperty
  : (shared.module.utilSetProperty = init())

export type CachedModule = ReturnType<typeof init>
