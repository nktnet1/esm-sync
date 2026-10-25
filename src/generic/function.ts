interface GenericFunctionAPI {
  bind<T, A extends unknown[], R>(func: (this: T, ...args: A) => R, thisArg: T): (...args: A) => R
  bind(
    func: typeof Function.prototype,
    thisArg: unknown,
    ...args: unknown[]
  ): (...args: unknown[]) => unknown
}
import shared from "../shared.js"
import unapply from "../util/unapply.js"

function init(): GenericFunctionAPI {
  return {
    bind: unapply(Function.prototype.bind)
  }
}

export default shared.inited
  ? shared.module.GenericFunction
  : (shared.module.GenericFunction = init())

export type CachedModule = ReturnType<typeof init>
