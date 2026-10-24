import isObjectLike from "./is-object-like.js"
import shared from "../shared.js"

function init() {
  function keys(object: unknown) {
    return isObjectLike(object) ? Object.keys(object) : []
  }

  return keys
}

export default shared.inited ? shared.module.utilKeys : (shared.module.utilKeys = init())

export type CachedModule = ReturnType<typeof init>
