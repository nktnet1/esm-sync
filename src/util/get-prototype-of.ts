import Reflect from "../reflection.js"
import isObjectLike from "./is-object-like.js"
import shared from "../shared.js"

function init() {
  function getPrototypeOf(object: unknown) {
    return isObjectLike(object) ? Reflect.getPrototypeOf(object) : null
  }

  return getPrototypeOf
}

export default shared.inited
  ? shared.module.utilGetPrototypeOf
  : (shared.module.utilGetPrototypeOf = init())

export type CachedModule = ReturnType<typeof init>
