import binding from "../binding.js"
import isObjectLike from "../util/is-object-like.js"
import safeRequire from "../safe/require.js"
import shared from "../shared.js"

function init(): (value: unknown) => import("../own/proxy.js").ProxyDetails | undefined {
  let realGetProxyDetails = safeRequire(shared.symbol.realGetProxyDetails)

  if (typeof realGetProxyDetails === "function") {
    return realGetProxyDetails as (
      value: unknown
    ) => import("../own/proxy.js").ProxyDetails | undefined
  }

  let useGetProxyDetails: boolean | undefined

  // Define as a function expression in case it is ever proxy wrapped in the future.
  realGetProxyDetails = function (value: unknown) {
    if (useGetProxyDetails === void 0) {
      useGetProxyDetails = typeof binding.util.getProxyDetails === "function"
    }

    if (useGetProxyDetails && isObjectLike(value)) {
      try {
        return binding.util.getProxyDetails!(value)
      } catch {}
    }
  }

  return realGetProxyDetails as (
    value: unknown
  ) => import("../own/proxy.js").ProxyDetails | undefined
}

export default shared.inited
  ? shared.module.realGetProxyDetails
  : (shared.module.realGetProxyDetails = init())

export type CachedModule = ReturnType<typeof init>
