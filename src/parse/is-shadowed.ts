import type { AstNode } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
import type { ShadowedMap } from "../types/visitor.js"
type AstPath = InstanceType<typeof FastPath<AstNode>>
import getShadowed from "./get-shadowed.js"
import shared from "../shared.js"

function init() {
  function isShadowed(path: AstPath, name: string, map: ShadowedMap): boolean {
    return getShadowed(path, name, map) !== null
  }

  return isShadowed
}

export default shared.inited
  ? shared.module.parseIsShadowed
  : (shared.module.parseIsShadowed = init())

export type CachedModule = ReturnType<typeof init>
