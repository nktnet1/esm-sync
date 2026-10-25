import shared from "../shared.js"

function init() {
  function identity<T>(value: T): T {
    return value
  }

  return identity
}

export default shared.inited ? shared.module.utilIdentity : (shared.module.utilIdentity = init())

export type CachedModule = ReturnType<typeof init>
