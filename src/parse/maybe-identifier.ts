import type { AstNode, Ast } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
type AstPath = InstanceType<typeof FastPath<AstNode>>
import isBindingIdentifier from "./is-binding-identifier.js"
import shared from "../shared.js"

function init() {
  function maybeIdentifier(
    path: AstPath,
    callback: (node: Ast<import("acorn").Identifier>, parent: AstNode) => void
  ): void {
    const node = path.getValue()

    let parent = path.getParentNode()

    if (parent === null || !isBindingIdentifier(node, parent)) {
      return
    }

    let nodeIndex = -2

    while (parent.type === "MemberExpression") {
      nodeIndex -= 2

      const grandParent = path.getNode(nodeIndex)

      if (grandParent === null) {
        break
      }

      parent = grandParent
    }

    callback(node, parent)
  }

  return maybeIdentifier
}

export default shared.inited
  ? shared.module.parseMaybeIdentifier
  : (shared.module.parseMaybeIdentifier = init())

export type CachedModule = ReturnType<typeof init>
