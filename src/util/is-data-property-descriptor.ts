import has from "./has.js"
import isObject from "./is-object.js"
import shared from "../shared.js"

function init() {
  function isDataPropertyDescriptor(
    descriptor: import("../reflection.js").Descriptor | undefined
  ): descriptor is import("../reflection.js").Descriptor & { value: unknown } {
    return (
      isObject(descriptor) &&
      descriptor.configurable === true &&
      descriptor.enumerable === true &&
      descriptor.writable === true &&
      has(descriptor, "value")
    )
  }

  return isDataPropertyDescriptor
}

export default shared.inited
  ? shared.module.utilIsDataPropertyDescriptor
  : (shared.module.utilIsDataPropertyDescriptor = init())

export type CachedModule = ReturnType<typeof init>
