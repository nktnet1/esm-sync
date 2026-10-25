import OwnProxy from "../own/proxy.js"

import isObjectLike from "./is-object-like.js"
import realGetProxyDetails from "../real/get-proxy-details.js"
import shared from "../shared.js"

function init() {
  function getProxyDetails(proxy: unknown): import("../own/proxy.js").ProxyDetails | undefined {
    const cache = shared.memoize.utilGetProxyDetails
    const cached = isObjectLike(proxy) ? cache.get(proxy) : void 0

    if (cached !== void 0) {
      return cached.details
    }

    if (!isObjectLike(proxy)) {
      return
    }

    const details = OwnProxy.instances.get(proxy) || realGetProxyDetails(proxy)

    cache.set(proxy, { details })

    return details
  }

  return getProxyDetails
}

export default shared.inited
  ? shared.module.utilGetProxyDetails
  : (shared.module.utilGetProxyDetails = init())

export type CachedModule = ReturnType<typeof init>
