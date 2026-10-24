import type { AstNode } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
import type { VisitorOptions, ShadowedMap } from "../types/visitor.js"
type Options = Pick<VisitorOptions, "possibleIndexes">
import Visitor from "../visitor.js"

import isShadowed from "../parse/is-shadowed.js"
import shared from "../shared.js"

function init() {
  const shadowedMap: ShadowedMap = new Map()

  class RequireVisitor extends Visitor<Options> {
    found = false

    reset(options?: Options) {
      this.options = options
      this.found = false
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
