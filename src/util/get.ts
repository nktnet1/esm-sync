import Reflect from "../reflection.js"
import shared from "../shared.js"

function init() {
  function get(object: unknown, name: PropertyKey, receiver?: unknown): unknown {
    if (object != null) {
      try {
        return receiver === void 0
          ? (Object(object) as Record<PropertyKey, unknown>)[name]
          : Reflect.get(Object(object) as object, name, receiver)
      } catch {}
    }
  }

  return get
}

export default shared.inited ? shared.module.utilGet : (shared.module.utilGet = init())

export type CachedModule = ReturnType<typeof init>
