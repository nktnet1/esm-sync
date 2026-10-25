import safe from "../util/safe.js"
import shared from "../shared.js"

type SafeJSON = Omit<JSON, "parse"> & { parse(value: unknown): unknown }
export default shared.inited
  ? shared.module.safeJSON
  : (shared.module.safeJSON = safe(shared.external.JSON) as SafeJSON)

export type CachedModule = SafeJSON
