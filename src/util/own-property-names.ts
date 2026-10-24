import isObjectLike from "./is-object-like.js"
import shared from "../shared.js"

function init() {
  function ownPropertyNames(object: unknown) {
    return isObjectLike(object) ? Object.getOwnPropertyNames(object) : []
  }

  return ownPropertyNames
}

export default shared.inited
  ? shared.module.utilOwnPropertyNames
  : (shared.module.utilOwnPropertyNames = init())

export type CachedModule = ReturnType<typeof init>
