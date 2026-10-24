import shared from "../shared.js"

function init() {
  function getCachePathHash(cacheName: unknown) {
    return typeof cacheName === "string" ? cacheName.slice(0, 8) : ""
  }

  return getCachePathHash
}

export default shared.inited
  ? shared.module.utilGetCachePathHash
  : (shared.module.utilGetCachePathHash = init())

export type CachedModule = ReturnType<typeof init>
