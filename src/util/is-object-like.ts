import shared from "../shared.js"

function init() {
  function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
    const type = typeof value

    return type === "function" || (type === "object" && value !== null)
  }

  return isObjectLike
}

export default shared.inited
  ? shared.module.utilIsObjectLike
  : (shared.module.utilIsObjectLike = init())

export type CachedModule = ReturnType<typeof init>
