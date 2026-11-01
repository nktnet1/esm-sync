import decodeURI from "./decode-uri.js"
import encodeURI from "./encode-uri.js"
import shared from "../shared.js"

function init() {
  const questionMarkHashRegExp = /[?#]/

  function getURLQueryFragment(request: string, preserveEmpty = false) {
    const index = typeof request === "string" ? request.search(questionMarkHashRegExp) : -1

    if (index === -1) return ""
    const suffix = decodeURI(encodeURI(request.slice(index)))
    if (preserveEmpty) return suffix
    // Node's realpath URL reconstruction discards empty search/hash fields.
    const hashIndex = suffix.indexOf("#")
    const query = suffix[0] === "?" ? suffix.slice(1, hashIndex === -1 ? undefined : hashIndex) : ""
    const fragment = hashIndex === -1 ? "" : suffix.slice(hashIndex + 1)
    return (query === "" ? "" : "?" + query) + (fragment === "" ? "" : "#" + fragment)
  }

  return getURLQueryFragment
}

export default shared.inited
  ? shared.module.utilGetURLQueryFragment
  : (shared.module.utilGetURLQueryFragment = init())

export type CachedModule = ReturnType<typeof init>
