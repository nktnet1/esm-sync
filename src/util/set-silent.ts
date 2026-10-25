import shared from "../shared.js"
import silent from "./silent.js"

function init() {
  function setSilent(object: object, name: PropertyKey, value: unknown) {
    silent(() => {
      try {
        ;(object as Record<PropertyKey, unknown>)[name] = value
      } catch {}
    })
  }

  return setSilent
}

export default shared.inited ? shared.module.utilSetSilent : (shared.module.utilSetSilent = init())

export type CachedModule = ReturnType<typeof init>
