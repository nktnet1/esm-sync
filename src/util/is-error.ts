import binding from "../binding.js"
import safeUtil from "../safe/util.js"
import shared from "../shared.js"

function init(): (value: unknown) => value is Error & { code?: unknown; path?: unknown } {
  const { types } = safeUtil

  if (typeof (types && types.isNativeError) === "function") {
    return types.isNativeError
  }

  const { isNativeError } = binding.util

  return typeof isNativeError === "function"
    ? (isNativeError as (value: unknown) => value is Error & { code?: unknown; path?: unknown })
    : (safeUtil as typeof safeUtil & { isError: (value: unknown) => value is Error }).isError
}

export default shared.inited ? shared.module.utilIsError : (shared.module.utilIsError = init())

export type CachedModule = ReturnType<typeof init>
