import COMPILER from "../constant/compiler.js"

import Visitor from "../visitor.js"

import isShadowed from "../parse/is-shadowed.js"
import overwrite from "../parse/overwrite.js"
import shared from "../shared.js"

export const ESM_SYNC_REQUIRE_REPLACEMENT = "__esm_sync_require_replacement__"

function init() {
  const {
    TRANSFORMS_REQUIRE_DECLARATION
  } = COMPILER

  const shadowedMap = new Map

  class RequireDeclarationVisitor extends Visitor {
    reset(options) {
      this.magicString = null
      this.possibleIndexes = null
      this.runtimeName = null
      this.transforms = 0

      if (options !== void 0) {
        this.magicString = options.magicString
        this.possibleIndexes = options.possibleIndexes
        this.runtimeName = options.runtimeName
      }
    }

    visitVariableDeclarator(path) {
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

      // ESM_SYNC_REQUIRE_REPLACEMENT is not necessarily unique, but it's tricky here to
      // get a unique name and the odds of conflict are vanishingly small.
      overwrite(this, identifier.start, identifier.end, ESM_SYNC_REQUIRE_REPLACEMENT)
      this.transforms |= TRANSFORMS_REQUIRE_DECLARATION

      this.visitChildren(path)
    }

    visitIdentifier(path) {
      const node = path.getValue()
      const { name } = node

      if (name !== "require" || isShadowed(path, "require", shadowedMap)) {
        this.visitChildren(path)
        return
      }

      overwrite(this, node.start, node.end, ESM_SYNC_REQUIRE_REPLACEMENT)
      this.transforms |= TRANSFORMS_REQUIRE_DECLARATION

      this.visitChildren(path)
    }
  }

  return new RequireDeclarationVisitor
}

export default shared.inited
  ? shared.module.visitorRequireDeclaration
  : shared.module.visitorRequireDeclaration = init()
