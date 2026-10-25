import realRequire from "./require.js"
import shared from "../shared.js"
import unwrapProxy from "../util/unwrap-proxy.js"

export default shared.inited
  ? shared.module.RealModule
  : (shared.module.RealModule = unwrapProxy(realRequire("module")) as CachedModule)

export type CachedModule = import("../types/runtime.js").ModuleConstructor
