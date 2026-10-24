import has from "./has.js"
import shared from "../shared.js"

function init() {
  function isObjectEmpty(object: unknown) {
    for (const name in Object(object)) {
      if (has(object, name)) {
        return false
      }
    }

    return true
  }

  return isObjectEmpty
}

export default shared.inited
  ? shared.module.utilIsObjectEmpty
  : (shared.module.utilIsObjectEmpty = init())

export type CachedModule = ReturnType<typeof init>
