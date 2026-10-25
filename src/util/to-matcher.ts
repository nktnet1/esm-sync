import isRegExp from "./is-regexp.js"
import shared from "../shared.js"

function init() {
  function toMatcher(source: unknown): (value: unknown) => unknown {
    if (typeof source === "function") {
      return (value: unknown): unknown => source(value)
    }

    if (isRegExp(source)) {
      return (value: unknown) => (source as { test(value: unknown): unknown }).test(value)
    }

    return (value: unknown) => value === source
  }

  return toMatcher
}

export default shared.inited ? shared.module.utilToMatcher : (shared.module.utilToMatcher = init())

export type CachedModule = ReturnType<typeof init>
