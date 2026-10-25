import type { AstNode } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
import type { VisitorOptions, ShadowedMap } from "../types/visitor.js"
type Options = Pick<
  VisitorOptions,
  "magicString" | "possibleIndexes" | "runtimeName" | "strict" | "transformUpdateBindings"
>
import COMPILER from "../constant/compiler.js"

import Visitor from "../visitor.js"

import isBindingIdentifier from "../parse/is-binding-identifier.js"
import isShadowed from "../parse/is-shadowed.js"
import overwrite from "../parse/overwrite.js"
import shared from "../shared.js"

function init() {
  const { TRANSFORMS_EVAL } = COMPILER

  const shadowedMap: ShadowedMap = new Map()

  class EvalVisitor extends Visitor<Options> {
    get magicString(): Options["magicString"] {
      return this.currentOptions.magicString
    }
    get runtimeName(): Options["runtimeName"] {
      return this.currentOptions.runtimeName
    }
    get strict(): Options["strict"] {
      return this.currentOptions.strict
    }
    get transformUpdateBindings(): Options["transformUpdateBindings"] {
      return this.currentOptions.transformUpdateBindings
    }
    reset(options?: Options) {
      this.options = options
      this.transforms = 0
    }

    visitCallExpression(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "CallExpression" }>>>
    ) {
      const node = path.getValue()
      const { callee } = node

      if (callee.name !== "eval") {
        this.visitChildren(path)
        return
      }

      if (node.arguments.length === 0) {
        return
      }

      // Support direct eval:
      // eval(code)
      this.transforms |= TRANSFORMS_EVAL

      const { end } = node
      const { magicString, runtimeName } = this

      const code = this.strict
        ? runtimeName + ".c"
        : "(eval===" + runtimeName + ".v?" + runtimeName + ".c:" + runtimeName + ".k)"

      magicString.prependLeft(callee.end, "(" + code).prependRight(end, ")")

      if (this.transformUpdateBindings) {
        magicString.prependLeft(node.start, runtimeName + ".u(").prependRight(end, ")")
      }

      path.call(this, "visitWithoutReset", "arguments")
    }

    visitIdentifier(path: InstanceType<typeof FastPath<Extract<AstNode, { type: "Identifier" }>>>) {
      const node = path.getValue()

      if (node.name !== "eval") {
        return
      }

      const parent = path.getParentNode()
      if (parent === null) return
      const { type } = parent

      if (
        (type === "UnaryExpression" && parent.operator === "typeof") ||
        !isBindingIdentifier(node, parent) ||
        isShadowed(path, "eval", shadowedMap)
      ) {
        return
      }

      // Support indirect eval:
      // o = { eval }
      // o.e = eval
      // f(eval)
      // (0, eval)(code)
      this.transforms |= TRANSFORMS_EVAL

      const { end, start } = node
      const { runtimeName } = this

      const code = this.strict
        ? runtimeName + ".e"
        : "(eval===" + runtimeName + ".v?" + runtimeName + ".e:eval)"

      if (type === "Property" && parent.shorthand) {
        this.magicString.prependLeft(end, ":" + code)
      } else {
        overwrite(this, start, end, code)
      }
    }
  }

  return new EvalVisitor()
}

export default shared.inited ? shared.module.visitorEval : (shared.module.visitorEval = init())

export type CachedModule = ReturnType<typeof init>
