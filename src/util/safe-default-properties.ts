import get from "./get.js"
import has from "./has.js"
import ownKeys from "./own-keys.js"
import safeCopyProperty from "./safe-copy-property.js"
import shared from "../shared.js"

function init() {
  function safeDefaultProperties<T extends object>(object: T, ...sources: unknown[]): T {
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]
      const names = ownKeys(source)

      for (const name of names) {
        if (has(source, name) && (!has(object, name) || get(object, name) === void 0)) {
          safeCopyProperty(object, source, name)
        }
      }
    }

    return object
  }

  return safeDefaultProperties
}

export default shared.inited
  ? shared.module.utilSafeDefaultProperties
  : (shared.module.utilSafeDefaultProperties = init())

export type CachedModule = ReturnType<typeof init>
