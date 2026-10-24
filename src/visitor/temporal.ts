import type { AstNode } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
import type { VisitorOptions, ShadowedMap } from "../types/visitor.js"
type Options = Pick<
  VisitorOptions,
  "magicString" | "possibleIndexes" | "runtimeName" | "temporalBindings" | "assignmentTargets"
>
import COMPILER from "../constant/compiler.js"

import Visitor from "../visitor.js"

import getNamesFromPattern from "../parse/get-names-from-pattern.js"
import isShadowed from "../parse/is-shadowed.js"
import maybeIdentifier from "../parse/maybe-identifier.js"
import overwrite from "../parse/overwrite.js"
import shared from "../shared.js"

function init() {
  const { TRANSFORMS_TEMPORALS } = COMPILER

  const shadowedMap: ShadowedMap = new Map()

  class TemporalVisitor extends Visitor<Options> {
    get magicString(): Options["magicString"] {
      return this.currentOptions.magicString
    }
    get runtimeName(): Options["runtimeName"] {
      return this.currentOptions.runtimeName
    }
    get temporalBindings(): Options["temporalBindings"] {
      return this.currentOptions.temporalBindings
    }
    get assignmentTargets(): Options["assignmentTargets"] {
      return this.currentOptions.assignmentTargets
    }
    reset(options?: Options) {
      this.options = options
      this.transforms = 0
    }

    visitIdentifier(path: InstanceType<typeof FastPath<Extract<AstNode, { type: "Identifier" }>>>) {
      const node = path.getValue()
      if (this.assignmentTargets?.has(node)) return
      const { name } = node

      if (!this.temporalBindings.has(name) || isShadowed(path, name, shadowedMap)) {
        return
      }

      const { magicString, runtimeName } = this

      maybeIdentifier(path, (node, parent) => {
        this.transforms |= TRANSFORMS_TEMPORALS

        const { end, start } = node

        if (parent.shorthand) {
          magicString.prependLeft(end, ":" + runtimeName + '.a("' + name + '",' + name + ")")

          return
        }

        let prefix = ""
        let suffix = ""

        if (parent.type === "NewExpression") {
          prefix = "("
          suffix = ")"
        }

        overwrite(
          this,
          start,
          end,
          prefix + runtimeName + '.a("' + name + '",' + name + ")" + suffix
        )
      })
    }

    visitExportDefaultDeclaration(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "ExportDefaultDeclaration" }>>>
    ) {
      const node = path.getValue()
      const { declaration } = node

      if (declaration.type !== "FunctionDeclaration") {
        // Instrument for non-hoisted values.
        this.transforms |= TRANSFORMS_TEMPORALS

        this.magicString.appendRight(declaration.end, this.runtimeName + '.j(["default"]);')
      }

      path.call(this, "visitWithoutReset", "declaration")
    }

    visitExportNamedDeclaration(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "ExportNamedDeclaration" }>>>
    ) {
      const node = path.getValue()
      const { declaration, specifiers } = node
      const initees = new Set()

      if (declaration != null) {
        const { type } = declaration

        if (type === "ClassDeclaration") {
          initees.add(declaration.id.name)
        } else if (type === "VariableDeclaration") {
          // Instrument for exported variable lists:
          // export let name1, name2, ..., nameN
          for (const { id } of declaration.declarations) {
            const names = getNamesFromPattern(id)

            for (const name of names) {
              initees.add(name)
            }
          }
        }
      } else if (node.source === null) {
        // Instrument for exported specifiers:
        // export { name1, name2, ..., nameN }
        for (const specifier of specifiers) {
          initees.add(specifier.exported.name)
        }
      } else {
        // Instrument for re-exported specifiers of an imported module:
        // export { name1, name2, ..., nameN } from "mod"
        for (const specifier of specifiers) {
          initees.add(specifier.exported.name)
        }
      }

      if (initees.size !== 0) {
        this.transforms |= TRANSFORMS_TEMPORALS

        const { end } = declaration || node

        this.magicString.appendRight(
          end,
          ";" + this.runtimeName + ".j(" + JSON.stringify([...initees]) + ");"
        )
      }

      if (declaration != null) {
        path.call(this, "visitWithoutReset", "declaration")
      }
    }
  }

  return new TemporalVisitor()
}

export default shared.inited
  ? shared.module.visitorTemporal
  : (shared.module.visitorTemporal = init())

export type CachedModule = ReturnType<typeof init>
