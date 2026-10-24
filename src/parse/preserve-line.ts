import type { AstNode } from "../types/acorn.js"
import type MagicString from "../magic-string.js"
type EditingVisitor = { magicString: InstanceType<typeof MagicString>; firstLineBreakPos?: number }
import overwrite from "./overwrite.js"
import shared from "../shared.js"

function init() {
  function preserveLine(visitor: EditingVisitor, { end, start }: AstNode) {
    return overwrite(visitor, start, end, "")
  }

  return preserveLine
}

export default shared.inited
  ? shared.module.parsePreserveLine
  : (shared.module.parsePreserveLine = init())

export type CachedModule = ReturnType<typeof init>
