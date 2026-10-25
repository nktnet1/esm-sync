import Reflect from "../reflection.js"
import shared from "../shared.js"

function init() {
  function wrap<A extends unknown[], R, T>(
    func: (this: T, ...args: A) => R,
    wrapper: (this: T, func: (this: T, ...args: A) => R, args: A) => R
  ) {
    return function (this: T, ...args: A) {
      return Reflect.apply(wrapper, this, [func, args])
    }
  }

  return wrap
}

export default shared.inited ? shared.module.utilWrap : (shared.module.utilWrap = init())

export type CachedModule = ReturnType<typeof init>
