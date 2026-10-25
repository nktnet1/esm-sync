import safe from "../util/safe.js"
import shared from "../shared.js"

export default shared.inited
  ? shared.module.safeGlobalConsole
  : (shared.module.safeGlobalConsole = safe(console))

export type CachedModule = typeof console
