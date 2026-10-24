import shared from "../shared.js"

function init(): import("../types/runtime.js").RuntimeRequire {
  try {
    const result = __non_webpack_require__(shared.symbol.realRequire)

    if (typeof result === "function") {
      return result as import("../types/runtime.js").RuntimeRequire
    }
  } catch {}

  return __non_webpack_require__
}

export default shared.inited ? shared.module.realRequire : (shared.module.realRequire = init())

export type CachedModule = ReturnType<typeof init>
