import type { AstNode } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
import type { VisitorOptions, ShadowedMap } from "../types/visitor.js"
type Options = Pick<
  VisitorOptions,
  | "assignableBindings"
  | "importedBindings"
  | "magicString"
  | "possibleIndexes"
  | "runtimeName"
  | "transformImportBindingAssignments"
  | "transformInsideFunctions"
  | "transformOutsideFunctions"
>
import Visitor from "../visitor.js"

import getNamesFromPattern from "../parse/get-names-from-pattern.js"
import isShadowed from "../parse/is-shadowed.js"
import isOutsideFunction from "../parse/is-outside-function.js"
import overwrite from "../parse/overwrite.js"
import shared from "../shared.js"

function init() {
  const scopeMap = new Map<AstNode, Map<string, boolean>>()
  const shadowedMap: ShadowedMap = new Map()

  class AssignmentVisitor extends Visitor<Options> {
    get assignableBindings(): Options["assignableBindings"] {
      return this.currentOptions.assignableBindings
    }
    get importedBindings(): Options["importedBindings"] {
      return this.currentOptions.importedBindings
    }
    get magicString(): Options["magicString"] {
      return this.currentOptions.magicString
    }
    get runtimeName(): Options["runtimeName"] {
      return this.currentOptions.runtimeName
    }
    get transformImportBindingAssignments(): Options["transformImportBindingAssignments"] {
      return this.currentOptions.transformImportBindingAssignments
    }
    get transformInsideFunctions(): Options["transformInsideFunctions"] {
      return this.currentOptions.transformInsideFunctions
    }
    get transformOutsideFunctions(): Options["transformOutsideFunctions"] {
      return this.currentOptions.transformOutsideFunctions
    }
    reset(options?: Options) {
      this.options = options
    }

    visitAssignmentExpression(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "AssignmentExpression" }>>>
    ) {
      checkAndMaybeWrap(this, path, "left")
      path.call(this, "visitWithoutReset", "right")
    }

    visitUpdateExpression(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "UpdateExpression" }>>>
    ) {
      checkAndMaybeWrap(this, path, "argument")
    }
  }

  function checkAndMaybeWrap(
    visitor: AssignmentVisitor,
    path: InstanceType<
      typeof FastPath<Extract<AstNode, { type: "AssignmentExpression" | "UpdateExpression" }>>
    >,
    childName: "left" | "argument"
  ) {
    const { assignableBindings, importedBindings, magicString, runtimeName } = visitor

    const node = path.getValue()
    const child =
      childName === "left" && node.type === "AssignmentExpression"
        ? node.left
        : node.type === "UpdateExpression"
          ? node.argument
          : null
    if (child === null) return
    const names = getNamesFromPattern(child)
    const { end, start } = node

    if (visitor.transformImportBindingAssignments) {
      for (const name of names) {
        if (importedBindings.has(name) && !isShadowed(path, name, shadowedMap)) {
          // Throw a type error for assignments to imported bindings.
          const { original } = magicString
          const right = node.type === "AssignmentExpression" ? node.right : void 0

          let code =
            runtimeName +
            ".b(" +
            JSON.stringify(original.slice(child.start, child.end)) +
            ',"' +
            node.operator +
            '"'

          if (right !== void 0) {
            code += "," + original.slice(right.start, right.end)
          }

          code += ")"

          overwrite(visitor, start, end, code)

          break
        }
      }
    }

    const { transformInsideFunctions, transformOutsideFunctions } = visitor

    if (transformInsideFunctions || transformOutsideFunctions) {
      const instrumentBoth = transformInsideFunctions && transformOutsideFunctions

      for (const name of names) {
        if (assignableBindings.has(name) && !isShadowed(path, name, shadowedMap)) {
          if (
            instrumentBoth ||
            (transformInsideFunctions && !isOutsideFunction(path, name, scopeMap)) ||
            (transformOutsideFunctions && isOutsideFunction(path, name, scopeMap))
          ) {
            // Wrap assignments to exported identifiers.
            magicString.prependLeft(start, runtimeName + ".u(").prependRight(end, ")")

            break
          }
        }
      }
    }
  }

  return new AssignmentVisitor()
}

export default shared.inited
  ? shared.module.visitorAssignment
  : (shared.module.visitorAssignment = init())

export type CachedModule = ReturnType<typeof init>
