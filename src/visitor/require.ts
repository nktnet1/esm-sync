import type { AstNode } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
import type { VisitorOptions, ShadowedMap } from "../types/visitor.js"
type Options = Pick<VisitorOptions, "possibleIndexes">
import Visitor from "../visitor.js"

import isBindingIdentifier from "../parse/is-binding-identifier.js"
import isShadowed from "../parse/is-shadowed.js"
import shared from "../shared.js"

function init() {
  const shadowedMap: ShadowedMap = new Map()

  class RequireVisitor extends Visitor<Options> {
    found = false
    foundCJSExports = false

    reset(options?: Options) {
      this.options = options
      this.found = false
      this.foundCJSExports = false
    }

    visitIdentifier(path: InstanceType<typeof FastPath<Extract<AstNode, { type: "Identifier" }>>>) {
      const node = path.getValue()
      if (node.name !== "exports" && node.name !== "module") return
      const parent = path.getParentNode()
      if (
        parent !== null &&
        isBindingIdentifier(node, parent) &&
        !isShadowed(path, node.name, shadowedMap)
      ) {
        this.foundCJSExports = true
      }
    }

    visitCallExpression(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "CallExpression" }>>>
    ) {
      const node = path.getValue()
      const { callee } = node

      if (callee.name !== "require") {
        this.visitChildren(path)
        return
      }

      if (node.arguments.length === 0 || isShadowed(path, "require", shadowedMap)) {
        return
      }

      this.found = true

      path.call(this, "visitWithoutReset", "arguments")
    }
  }

  return new RequireVisitor()
}

export default shared.inited
  ? shared.module.visitorRequire
  : (shared.module.visitorRequire = init())

export type CachedModule = ReturnType<typeof init>
