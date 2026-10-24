import Reflect from "../reflection.js"
import captureStackTrace from "../error/capture-stack-trace.js"
import shared from "../shared.js"

function init() {
  function nativeTrap<A extends unknown[], R, T>(func: (this: T, ...args: A) => R) {
    function trap(this: T, ...args: A) {
      try {
        return Reflect.apply(func, this, args)
      } catch (e) {
        captureStackTrace(e, trap)

        throw e
      }
    }

    return trap
  }

  return nativeTrap
}

export default shared.inited
  ? shared.module.utilNativeTrap
  : (shared.module.utilNativeTrap = init())

export type CachedModule = ReturnType<typeof init>
