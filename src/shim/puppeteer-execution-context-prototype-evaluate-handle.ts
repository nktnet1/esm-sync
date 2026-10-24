import Reflect from "../reflection.js"
import OwnProxy from "../own/proxy.js"

import has from "../util/has.js"
import isObjectLike from "../util/is-object-like.js"
import isOwnProxy from "../util/is-own-proxy.js"
import nativeTrap from "../util/native-trap.js"
import proxyWrap from "../util/proxy-wrap.js"
import shared from "../shared.js"
import untransformRuntime from "../util/untransform-runtime.js"

function init() {
  const Shim = {
    enable(exported: unknown): unknown {
      const cache = shared.memoize.shimPuppeteerExecutionContextPrototypeEvaluateHandle

      if (check(exported, cache)) {
        return exported
      }

      const ExecutionContextProto = (
        exported as {
          ExecutionContext: {
            prototype: { evaluateHandle: (this: unknown, ...args: unknown[]) => unknown }
          }
        }
      ).ExecutionContext.prototype

      const evaluateHandleWrapper = proxyWrap(
        ExecutionContextProto.evaluateHandle,
        function (this: unknown, evaluateHandle, args) {
          const [pageFunction] = args

          if (typeof pageFunction === "function") {
            const pageFunctionProxy = new OwnProxy(pageFunction, {
              get(pageFunction, name, receiver) {
                if (name === "toString" && !has(pageFunction, "toString")) {
                  return toStringProxy
                }

                if (receiver === pageFunctionProxy) {
                  receiver = pageFunction
                }

                return Reflect.get(pageFunction, name, receiver)
              }
            })

            const toStringProxy = new OwnProxy(pageFunction.toString, {
              apply: nativeTrap((toString, thisArg, args) => {
                if (thisArg === pageFunctionProxy) {
                  thisArg = pageFunction
                }

                const result = Reflect.apply(toString, thisArg, args)

                return typeof result === "string" ? untransformRuntime(result) : result
              })
            })

            args[0] = pageFunctionProxy
          }

          return Reflect.apply(evaluateHandle, this, args)
        }
      )

      if (
        Reflect.defineProperty(ExecutionContextProto, "evaluateHandle", {
          configurable: true,
          value: evaluateHandleWrapper,
          writable: true
        })
      ) {
        cache.set(ExecutionContextProto as object, true)
      }

      return exported
    }
  }

  function check(exported: unknown, cache: WeakMap<object, boolean>): boolean {
    const ExecutionContext = isObjectLike(exported) ? exported.ExecutionContext : void 0

    const ExecutionContextProto: unknown =
      typeof ExecutionContext === "function" ? Reflect.get(ExecutionContext, "prototype") : void 0

    const evaluateHandle = isObjectLike(ExecutionContextProto)
      ? ExecutionContextProto.evaluateHandle
      : void 0

    if (typeof evaluateHandle !== "function") {
      return true
    }

    let cached = cache.get(ExecutionContextProto as object)

    if (cached !== void 0) {
      return cached
    }

    cached = isOwnProxy(evaluateHandle)
    cache.set(ExecutionContextProto as object, cached)

    return cached
  }

  return Shim
}

export default shared.inited
  ? shared.module.shimPuppeteerExecutionContextPrototypeEvaluateHandle
  : (shared.module.shimPuppeteerExecutionContextPrototypeEvaluateHandle = init())

export type CachedModule = ReturnType<typeof init>
