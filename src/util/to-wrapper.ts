import Reflect from "../reflection.js"
import shared from "../shared.js"

function init() {
  function toWrapper<A extends unknown[], R, T>(func: (this: T, ...args: A) => R) {
    return function (this: T, _unwrapped: unknown, args: A) {
      return Reflect.apply(func, this, args)
    }
  }

  return toWrapper
}

export default shared.inited ? shared.module.utilToWrapper : (shared.module.utilToWrapper = init())

export type CachedModule = ReturnType<typeof init>
