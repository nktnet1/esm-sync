import shared from "../shared.js"

function init() {
  return {} as Record<PropertyKey, unknown>
}

export default shared.inited
  ? shared.module.utilEmptyObject
  : (shared.module.utilEmptyObject = init())

export type CachedModule = ReturnType<typeof init>
