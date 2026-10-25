import getProxyDetails from "./get-proxy-details.js"
import isObjectLike from "./is-object-like.js"
import shared from "../shared.js"

function init() {
  function unwrapProxy<T>(value: T): T {
    if (!isObjectLike(value)) {
      return value
    }

    const cache = shared.memoize.utilUnwrapProxy
    const cached = cache.get(value)

    if (cached !== void 0) {
      return cached as T
    }

    let details: import("../own/proxy.js").ProxyDetails | undefined
    let unwrapped: object = value

    while ((details = getProxyDetails(unwrapped)) !== void 0) {
      unwrapped = details[0]
    }

    cache.set(value, unwrapped)

    return unwrapped as T
  }

  return unwrapProxy
}

export default shared.inited
  ? shared.module.utilUnwrapProxy
  : (shared.module.utilUnwrapProxy = init())

export type CachedModule = ReturnType<typeof init>
