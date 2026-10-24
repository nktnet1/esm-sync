import shared from "../shared.js"
import toMatcher from "./to-matcher.js"

function init() {
  function matches(array: readonly unknown[], pattern: unknown) {
    let matcher: ((value: unknown) => unknown) | undefined

    for (const value of array) {
      if (matcher === void 0) {
        matcher = toMatcher(pattern)
      }

      if (matcher(value)) {
        return true
      }
    }

    return false
  }

  return matches
}

export default shared.inited ? shared.module.utilMatches : (shared.module.utilMatches = init())

export type CachedModule = ReturnType<typeof init>
