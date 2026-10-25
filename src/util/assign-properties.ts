import copyProperty from "./copy-property.js"
import ownKeys from "./own-keys.js"
import shared from "../shared.js"

function init() {
  function assignProperties<T extends object>(object: T, ...sources: unknown[]): T {
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]
      const names = ownKeys(source)

      for (const name of names) {
        copyProperty(object, source, name)
      }
    }

    return object
  }

  return assignProperties
}

export default shared.inited
  ? shared.module.utilAssignProperties
  : (shared.module.utilAssignProperties = init())

export type CachedModule = ReturnType<typeof init>
