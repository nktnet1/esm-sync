import isObject from "./is-object.js"
import shared from "../shared.js"

function init() {
  function isDescriptorMatch(
    currentDescriptor: PropertyDescriptor | undefined,
    newDescriptor: PropertyDescriptor
  ) {
    if (!isObject(currentDescriptor)) {
      return !isObject(newDescriptor)
    }

    for (const name in newDescriptor) {
      if (
        !Object.is(
          (currentDescriptor as Record<string, unknown>)[name],
          (newDescriptor as Record<string, unknown>)[name]
        )
      ) {
        return false
      }
    }

    return true
  }

  return isDescriptorMatch
}

export default shared.inited
  ? shared.module.utilIsDescriptorMatch
  : (shared.module.utilIsDescriptorMatch = init())

export type CachedModule = ReturnType<typeof init>
