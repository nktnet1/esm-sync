type Arguments<F> = F extends (...args: infer A) => unknown
  ? A
  : F extends abstract new (
        ...args: infer A
      ) => unknown
    ? A
    : unknown[]
import Reflect from "../reflection.js"
import OwnProxy from "../own/proxy.js"

import shared from "../shared.js"

function init() {
  function proxyWrap<F extends object, T>(
    func: F,
    wrapper: (this: T, func: F, args: Arguments<F>) => unknown
  ) {
    return new OwnProxy(func, {
      apply(func, thisArg, args) {
        return Reflect.apply(wrapper, thisArg as T, [func, args as Arguments<F>])
      },
      construct(func, args, newTarget) {
        return Reflect.construct(wrapper, [func, args], newTarget)
      }
    })
  }

  return proxyWrap
}

export default shared.inited ? shared.module.utilProxyWrap : (shared.module.utilProxyWrap = init())

export type CachedModule = ReturnType<typeof init>
