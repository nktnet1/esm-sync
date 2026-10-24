import binding from "../binding.js"
import isObjectLike from "./is-object-like.js"
import shared from "../shared.js"

function init() {
  let useSetHiddenValue: boolean | undefined

  function setHiddenValue(object: unknown, name: unknown, value: unknown) {
    if (useSetHiddenValue === void 0) {
      useSetHiddenValue = typeof binding.util.setHiddenValue === "function"
    }

    if (
      useSetHiddenValue &&
      typeof name === shared.utilBinding.hiddenKeyType &&
      name != null &&
      isObjectLike(object)
    ) {
      try {
        return binding.util.setHiddenValue!(object, name, value)
      } catch {}
    }

    return false
  }

  return setHiddenValue
}

export default shared.inited
  ? shared.module.utilSetHiddenValue
  : (shared.module.utilSetHiddenValue = init())

export type CachedModule = ReturnType<typeof init>
