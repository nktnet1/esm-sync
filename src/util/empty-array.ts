import shared from "../shared.js"

function init() {
  return [] as never[]
}

export default shared.inited
  ? shared.module.utilEmptyArray
  : (shared.module.utilEmptyArray = init())

export type CachedModule = ReturnType<typeof init>
