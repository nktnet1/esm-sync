import Reflect from "../reflection.js"
import allKeys from "./all-keys.js"
import isObject from "./is-object.js"
import safeAssignPropertiesIn from "./safe-assign-properties-in.js"
import safeCopyProperty from "./safe-copy-property.js"
import setPrototypeOf from "./set-prototype-of.js"
import shared from "../shared.js"

function init() {
  function safe<T>(value: T): T {
    if (typeof value !== "function") {
      if (Array.isArray(value)) {
        return Array.from(value) as T
      }

      return isObject(value) ? (safeAssignPropertiesIn({}, value) as T) : value
    }

    const Super = value

    const Safe = function (...args: unknown[]) {
      const result = Reflect.construct(Super, args) as object

      setPrototypeOf(result, SafeProto)

      return result
    }

    const SuperNames = allKeys(Super)

    for (const name of SuperNames) {
      if (name !== "prototype") {
        safeCopyProperty(Safe, Super, name)
      }
    }

    const SafeProto: object = Safe.prototype

    setPrototypeOf(SafeProto, null)
    safeAssignPropertiesIn(SafeProto, Super.prototype)

    return Safe as unknown as T
  }

  return safe
}

export default shared.inited ? shared.module.utilSafe : (shared.module.utilSafe = init())

export type CachedModule = ReturnType<typeof init>
