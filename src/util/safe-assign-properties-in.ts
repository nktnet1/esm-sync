import allKeys from "./all-keys.js"
import safeCopyProperty from "./safe-copy-property.js"
import shared from "../shared.js"

function init() {
  function safeAssignPropertiesIn<T extends object>(object: T, ...sources: unknown[]): T {
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]
      const names = allKeys(source)

      for (const name of names) {
        safeCopyProperty(object, source, name)
      }
    }

    return object
  }

  return safeAssignPropertiesIn
}

export default shared.inited
  ? shared.module.utilSafeAssignPropertiesIn
  : (shared.module.utilSafeAssignPropertiesIn = init())

export type CachedModule = ReturnType<typeof init>
