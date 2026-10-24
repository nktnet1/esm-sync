import type { AstNode } from "./types/acorn.js"
import type FastPath from "./fast-path.js"
import type { VisitorOptions } from "./types/visitor.js"
import Reflect from "./reflection.js"
// Based on `PathVisitor()` of ast-types.
// Copyright Ben Newman. Released under MIT license:
// https://github.com/benjamn/ast-types

import isObject from "./util/is-object.js"
import keys from "./util/keys.js"
import setPrototypeOf from "./util/set-prototype-of.js"
import shared from "./shared.js"

function init() {
  const childNamesMap = new Map<object, string[]>()

  const visitLookup = new Set([
    // ConditionalExpression
    "alternate",
    // ReturnStatement
    "argument",
    // CallExpression
    "arguments",
    // TryStatement
    "block",
    // BlockStatement, FunctionDeclaration, FunctionExpression
    "body",
    // CallExpression
    "callee",
    // SwitchStatement
    "cases",
    // ConditionalExpression, SwitchCase
    "consequent",
    // ExportDefaultDeclaration, ExportNamedDeclaration
    "declaration",
    // VariableDeclaration
    "declarations",
    // SwitchStatement
    "discriminant",
    // ArrayPattern
    "elements",
    // ExpressionStatement
    "expression",
    // SequenceExpression, TemplateLiteral
    "expressions",
    // TryStatement
    "finalizer",
    // TryStatement
    "handler",
    // ForStatement, VariableDeclarator
    "init",
    // Property
    "key",
    // AssignmentExpression, AssignmentPattern
    "left",
    // MemberExpression
    "object",
    // ObjectPattern
    "properties",
    // AssignmentExpression, AssignmentPattern
    "right",
    // ClassDeclaration
    "superClass",
    // ForStatement, IfStatement, SwitchCase, WhileStatement
    "test",
    // ForStatement
    "update",
    // Property
    "value"
  ])

  class Visitor<
    O extends Pick<VisitorOptions, "possibleIndexes"> = Pick<VisitorOptions, "possibleIndexes">
  > {
    protected options: O | undefined
    transforms = 0
    possibleStart = 0
    possibleEnd = 0
    protected get currentOptions(): O {
      if (this.options === undefined) throw new Error("Compiler visitor has not been initialized")
      return this.options
    }
    get possibleIndexes(): number[] {
      return this.currentOptions.possibleIndexes
    }
    reset(options?: O): void {
      this.options = options
    }
    visit(rootPath: InstanceType<typeof FastPath<AstNode>>, options: O) {
      this.reset(options)

      const { possibleIndexes } = this

      if (!Array.isArray(possibleIndexes) || possibleIndexes.length === 0) {
        return
      }

      this.possibleEnd = possibleIndexes.length
      this.possibleStart = 0

      this.visitWithoutReset(rootPath)
    }

    visitWithoutReset(path: InstanceType<typeof FastPath<AstNode>>) {
      const value = path.getValue()

      if (!isObject(value)) {
        return
      }

      if (Array.isArray(value)) {
        path.each(this, "visitWithoutReset")
        return
      }

      const methodName = "visit" + value.type

      const method = Reflect.get(this, methodName)
      if (typeof method === "function") {
        // The method must call `this.visitChildren(path)` to continue traversing.
        Reflect.apply(method, this, [path])
      } else {
        this.visitChildren(path)
      }
    }

    visitChildren(path: InstanceType<typeof FastPath<AstNode>>) {
      const node = path.getValue()
      const { end, start } = node
      const { possibleIndexes } = this

      const oldLeft = this.possibleStart
      const oldRight = this.possibleEnd

      let left = oldLeft
      let right = oldRight

      if (typeof start === "number" && typeof end === "number") {
        // Find first index not less than `node.start`.
        while (left < right && possibleIndexes[left]! < start) {
          left += 1
        }

        // Find first index not greater than `node.end`.
        while (left < right && possibleIndexes[right - 1]! > end) {
          right -= 1
        }
      }

      if (left < right) {
        this.possibleStart = left
        this.possibleEnd = right

        const names = getChildNames(node)

        for (const name of names) {
          path.call(this, "visitWithoutReset", name)
        }

        this.possibleStart = oldLeft
        this.possibleEnd = oldRight
      }
    }
  }

  function getChildNames(value: AstNode): string[] {
    let childNames = childNamesMap.get(value)

    if (childNames !== void 0) {
      return childNames
    }

    childNames = []

    const names = keys(value)

    const noComputed = value.type !== "Property" || !value.computed

    for (const name of names) {
      if (noComputed && name === "key") {
        continue
      }

      if (visitLookup.has(name) && isObject(Reflect.get(value, name))) {
        childNames.push(name)
      }
    }

    childNamesMap.set(value, childNames)
    return childNames
  }

  setPrototypeOf(Visitor.prototype, null)

  return Visitor
}

export default shared.inited ? shared.module.Visitor : (shared.module.Visitor = init())

export type CachedModule = ReturnType<typeof init>
