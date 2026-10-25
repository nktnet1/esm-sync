import Reflect from "../reflection.js"
import silent from "./silent.js"
import shared from "../shared.js"

function init() {
  function getSilent(object: unknown, name: PropertyKey): unknown {
    const value = silent(() => {
      try {
        return (Object(object) as Record<PropertyKey, unknown>)[name]
      } catch {}
    })

    if (typeof value !== "function") {
      return value
    }

    return function (this: unknown, ...args: unknown[]) {
      return silent(() => Reflect.apply(value, this, args))
    }
  }

  return getSilent
}

export default shared.inited ? shared.module.utilGetSilent : (shared.module.utilGetSilent = init())

export type CachedModule = ReturnType<typeof init>
