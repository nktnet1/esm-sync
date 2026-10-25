import type { AstNode } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
import type { VisitorOptions, ShadowedMap } from "../types/visitor.js"
type Options = Pick<VisitorOptions, "globals" | "magicString" | "possibleIndexes" | "runtimeName">
import COMPILER from "../constant/compiler.js"

import Visitor from "../visitor.js"

import isBindingIdentifier from "../parse/is-binding-identifier.js"
import isShadowed from "../parse/is-shadowed.js"
import shared from "../shared.js"

function init() {
  const { TRANSFORMS_CONSOLE, TRANSFORMS_REFLECT } = COMPILER

  const shadowedMap: ShadowedMap = new Map()

  class GlobalsVisitor extends Visitor<Options> {
    get globals(): Options["globals"] {
      return this.currentOptions.globals
    }
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

    visitCallExpression(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "CallExpression" }>>>
    ) {
      const node = path.getValue()
      const { callee } = node

      if (callee.type !== "MemberExpression") {
        this.visitChildren(path)
        return
      }

      const { object } = callee
      const { name } = object
      if (name === undefined) {
        this.visitChildren(path)
        return
      }

      if (!this.globals.has(name)) {
        this.visitChildren(path)
        return
      }

      const args = node.arguments

      if (args.length === 0 || isShadowed(path, name, shadowedMap)) {
        return
      }

      if (name === "console") {
        let skip = true

        for (const { type } of args) {
          if (type !== "Literal" && type !== "TemplateLiteral") {
            skip = false
            break
          }
        }

        if (skip) {
          return
        }

        this.transforms |= TRANSFORMS_CONSOLE
      } else if (name === "Reflect") {
        this.transforms |= TRANSFORMS_REFLECT
      }

      this.magicString.prependLeft(object.start, this.runtimeName + ".g.")

      path.call(this, "visitWithoutReset", "arguments")
    }

    visitIdentifier(path: InstanceType<typeof FastPath<Extract<AstNode, { type: "Identifier" }>>>) {
      const node = path.getValue()
      const { name } = node

      if (!this.globals.has(name)) {
        return
      }

      const parent = path.getParentNode()
      if (parent === null) return
      const { type } = parent

      if (
        (type === "UnaryExpression" && parent.operator === "typeof") ||
        !isBindingIdentifier(node, parent) ||
        isShadowed(path, name, shadowedMap)
      ) {
        return
      }

      if (name === "console") {
        this.transforms |= TRANSFORMS_CONSOLE
      } else if (name === "Reflect") {
        this.transforms |= TRANSFORMS_REFLECT
      }

      let code = this.runtimeName + ".g."
      let pos = node.start

      if (type === "Property" && parent.shorthand) {
        code = ":" + code + name
        pos = node.end
      }

      this.magicString.prependLeft(pos, code)
    }
  }

  return new GlobalsVisitor()
}

export default shared.inited
  ? shared.module.visitorGlobals
  : (shared.module.visitorGlobals = init())

export type CachedModule = ReturnType<typeof init>
