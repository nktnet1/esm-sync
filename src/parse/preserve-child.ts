import type { AstNode } from "../types/acorn.js"
import type MagicString from "../magic-string.js"
type EditingVisitor = { magicString: InstanceType<typeof MagicString>; firstLineBreakPos?: number }
import overwrite from "./overwrite.js"
import shared from "../shared.js"

function init() {
  function preserveChild(
    visitor: EditingVisitor,
    parent: AstNode & { declaration?: AstNode | null },
    childName: "declaration"
  ) {
    const child = parent[childName]!
    const childStart = child.start
    const parentStart = parent.start

    let indentation = ""

    if (childStart > (visitor.firstLineBreakPos ?? -1)) {
      const count = childStart - parentStart

      indentation = count === 7 ? "       " : " ".repeat(count)
    }

    return overwrite(visitor, parentStart, childStart, indentation)
  }

  return preserveChild
}

export default shared.inited
  ? shared.module.parsePreserveChild
  : (shared.module.parsePreserveChild = init())

export type CachedModule = ReturnType<typeof init>
