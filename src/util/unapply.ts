import Reflect from "../reflection.js"
import shared from "../shared.js"

function init() {
  function unapply<A extends unknown[], R, T>(func: (this: T, ...args: A) => R) {
    return (thisArg: T, ...args: A) => Reflect.apply(func, thisArg, args)
  }

  return unapply
}

export default shared.inited ? shared.module.utilUnapply : (shared.module.utilUnapply = init())

export type CachedModule = ReturnType<typeof init>
