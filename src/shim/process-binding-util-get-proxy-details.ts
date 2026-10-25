import Reflect from "../reflection.js"
import OwnProxy from "../own/proxy.js"

import emptyObject from "../util/empty-object.js"
import isObjectLike from "../util/is-object-like.js"
import isOwnProxy from "../util/is-own-proxy.js"
import nativeTrap from "../util/native-trap.js"
import setProperty from "../util/set-property.js"
import shared from "../shared.js"
import silent from "../util/silent.js"

function init() {
  const Shim = {
    enable<T extends object>(context: T): T {
      const cache = shared.memoize.shimProcessBindingUtilGetProxyDetails

      let getProxyDetails: unknown
      let utilBinding: unknown

      silent(() => {
        try {
          const process = Reflect.get(context, "process") as { binding(name: string): unknown }
          utilBinding = process.binding("util")
          getProxyDetails = Reflect.get(utilBinding as object, "getProxyDetails")
        } catch {}
      })

      if (check(utilBinding, getProxyDetails, cache)) {
        return context
      }

      const trap = nativeTrap((getProxyDetails: typeof Function.prototype, ...rest: unknown[]) => {
        const [value] = rest[rest.length - 1] as unknown[]

        if (!isOwnProxy(value)) {
          return Reflect.apply(getProxyDetails, utilBinding, [value])
        }
      })

      if (
        setProperty(
          utilBinding,
          "getProxyDetails",
          new OwnProxy(getProxyDetails as typeof Function.prototype, {
            apply: trap,
            construct: trap
          })
        )
      ) {
        cache.set(utilBinding, true)
      }

      return context
    }
  }

  function check(
    utilBinding: unknown,
    getProxyDetails: unknown,
    cache: Map<unknown, boolean>
  ): boolean {
    if (!isObjectLike(utilBinding) || typeof getProxyDetails !== "function") {
      return true
    }

    let cached = cache.get(utilBinding)

    if (cached !== void 0) {
      return cached
    }

    cached = true

    try {
      cached = getProxyDetails(new OwnProxy(emptyObject, emptyObject)) === void 0
    } catch {}

    cache.set(utilBinding, cached)

    return cached
  }

  return Shim
}

export default shared.inited
  ? shared.module.shimProcessBindingUtilGetProxyDetails
  : (shared.module.shimProcessBindingUtilGetProxyDetails = init())

export type CachedModule = ReturnType<typeof init>
