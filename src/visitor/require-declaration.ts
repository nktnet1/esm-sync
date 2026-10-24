import type { AstNode } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
import type { VisitorOptions, ShadowedMap } from "../types/visitor.js"
type Options = Pick<VisitorOptions, "magicString" | "possibleIndexes" | "runtimeName">
import COMPILER from "../constant/compiler.js"

import Visitor from "../visitor.js"

import isShadowed from "../parse/is-shadowed.js"
import overwrite from "../parse/overwrite.js"
import shared from "../shared.js"

export function getEsmRequireReplacementName(runtimeName: string) {
  // This is not necessarily unique, but it's tricky here to get a unique name
  // and the odds of conflict are vanishingly small.
  return "__esm_sync_req__" + runtimeName
}

function init() {
  const { TRANSFORMS_REQUIRE_DECLARATION } = COMPILER

  const shadowedMap: ShadowedMap = new Map()

  class RequireDeclarationVisitor extends Visitor<Options> {
    get magicString(): Options["magicString"] {
      return this.currentOptions.magicString
    }
    get runtimeName(): Options["runtimeName"] {
      return this.currentOptions.runtimeName
    }
    reset(options?: Options) {
      this.options = options
      this.transforms = 0
    }

    visitVariableDeclarator(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "VariableDeclarator" }>>>
    ) {
      const node = path.getValue()

      if (node.id.type !== "Identifier") {
        this.visitChildren(path)
        return
      }

      const identifier = node.id

      const name = node.id.name
      if (name !== "require" || isShadowed(path, "require", shadowedMap)) {
        this.visitChildren(path)
        return
      }

      overwrite(
        this,
        identifier.start,
        identifier.end,
        getEsmRequireReplacementName(this.runtimeName)
      )
      this.transforms |= TRANSFORMS_REQUIRE_DECLARATION

      this.visitChildren(path)
    }

    visitIdentifier(path: InstanceType<typeof FastPath<Extract<AstNode, { type: "Identifier" }>>>) {
      const node = path.getValue()
      const { name } = node

      if (name !== "require" || isShadowed(path, "require", shadowedMap)) {
        this.visitChildren(path)
        return
      }

      overwrite(this, node.start, node.end, getEsmRequireReplacementName(this.runtimeName))
      this.transforms |= TRANSFORMS_REQUIRE_DECLARATION

      this.visitChildren(path)
    }
  }

  return new RequireDeclarationVisitor()
}

export default shared.inited
  ? shared.module.visitorRequireDeclaration
  : (shared.module.visitorRequireDeclaration = init())

export type CachedModule = ReturnType<typeof init>
