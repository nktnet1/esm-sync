import Reflect from "../reflection.js"
import realRequire from "../real/require.js"
import shared from "../shared.js"

function init() {
  const { resolve } = realRequire

  function safeRequire(request: string | symbol) {
    try {
      return realRequire(request)
    } catch {}
  }

  function safeResolve(request: string) {
    try {
      return Reflect.apply(resolve, realRequire, [request])
    } catch {}

    return ""
  }

  safeRequire.resolve = safeResolve

  return safeRequire
}

export default shared.inited ? shared.module.safeRequire : (shared.module.safeRequire = init())

export type CachedModule = ReturnType<typeof init>
