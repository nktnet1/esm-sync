import shared from "../shared.js"

function init() {
  function isObject(value: unknown): value is Record<PropertyKey, unknown> {
    return typeof value === "object" && value !== null
  }

  return isObject
}

export default shared.inited ? shared.module.utilIsObject : (shared.module.utilIsObject = init())

export type CachedModule = ReturnType<typeof init>
