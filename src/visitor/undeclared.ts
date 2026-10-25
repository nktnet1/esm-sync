import type { AstNode } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
import type { VisitorOptions, ShadowedMap } from "../types/visitor.js"
type Options = Pick<
  VisitorOptions,
  "magicString" | "possibleIndexes" | "runtimeName" | "undeclared"
>
import COMPILER from "../constant/compiler.js"

import Visitor from "../visitor.js"

import isBindingIdentifier from "../parse/is-binding-identifier.js"
import isShadowed from "../parse/is-shadowed.js"
import maybeIdentifier from "../parse/maybe-identifier.js"
import overwrite from "../parse/overwrite.js"
import shared from "../shared.js"

function init() {
  const { TRANSFORMS_UNDECLARED } = COMPILER

  const shadowedMap: ShadowedMap = new Map()

  class UndeclaredVisitor extends Visitor<Options> {
    get magicString(): Options["magicString"] {
      return this.currentOptions.magicString
    }
    get runtimeName(): Options["runtimeName"] {
      return this.currentOptions.runtimeName
    }
    get undeclared(): Options["undeclared"] {
      return this.currentOptions.undeclared
    }
    reset(options?: Options) {
      this.options = options
      this.transforms = 0
    }

    visitIdentifier(path: InstanceType<typeof FastPath<Extract<AstNode, { type: "Identifier" }>>>) {
      const node = path.getValue()
      const { name } = node
      const parent = path.getParentNode()
      if (parent === null) return

      if (
        !this.undeclared.has(name) ||
        !isBindingIdentifier(node, parent) ||
        isShadowed(path, name, shadowedMap)
      ) {
        return
      }

      const { runtimeName } = this

      if (parent.type === "UnaryExpression" && parent.operator === "typeof") {
        this.transforms |= TRANSFORMS_UNDECLARED
        overwrite(this, node.start, node.end, runtimeName + ".g." + name)
        return
      }

      maybeIdentifier(path, (node, parent) => {
        this.transforms |= TRANSFORMS_UNDECLARED

        const { end, start } = node

        if (parent.shorthand) {
          this.magicString.prependLeft(end, ":" + runtimeName + '.t("' + name + '")')

          return
        }

        let prefix = ""
        let suffix = ""

        if (parent.type === "NewExpression") {
          prefix = "("
          suffix = ")"
        }

        overwrite(this, start, end, prefix + runtimeName + '.t("' + name + '")' + suffix)
      })
    }
  }

  return new UndeclaredVisitor()
}

export default shared.inited
  ? shared.module.visitorUndeclared
  : (shared.module.visitorUndeclared = init())

export type CachedModule = ReturnType<typeof init>
