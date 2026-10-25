import Reflect from "../reflection.js"
import isObjectLike from "./is-object-like.js"
import shared from "../shared.js"

function init() {
  function setPrototypeOf(object: unknown, proto: unknown): boolean {
    return (
      isObjectLike(object) && Reflect.setPrototypeOf(object, isObjectLike(proto) ? proto : null)
    )
  }

  return setPrototypeOf
}

export default shared.inited
  ? shared.module.utilSetPrototypeOf
  : (shared.module.utilSetPrototypeOf = init())

export type CachedModule = ReturnType<typeof init>
