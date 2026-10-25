import shared from "../shared.js"

function init() {
  const { toString } = Object.prototype

  function getObjectTag(value: unknown) {
    return toString.call(value)
  }

  return getObjectTag
}

export default shared.inited
  ? shared.module.utilGetToStringTag
  : (shared.module.utilGetToStringTag = init())

export type CachedModule = ReturnType<typeof init>
