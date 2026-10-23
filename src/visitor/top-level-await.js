import COMPILER from "../constant/compiler.js"
import Visitor from "../visitor.js"
import shared from "../shared.js"

function init() {
  const { TRANSFORMS_TOP_LEVEL_AWAIT } = COMPILER

  class TopLevelAwaitVisitor extends Visitor {
    reset(options) {
      this.magicString = options?.magicString
      this.possibleIndexes = options?.possibleIndexes
      this.runtimeName = options?.runtimeName
      this.transforms = 0
    }

    // Only module-body awaits may become yields in the loader's generator.
    // Await expressions inside async functions must retain native semantics.
    visitFunctionDeclaration() {}
    visitFunctionExpression() {}
    visitArrowFunctionExpression() {}

    visitMethodDefinition(path) {
      if (path.getValue().computed) {
        path.call(this, "visitWithoutReset", "key")
      }
      path.call(this, "visitWithoutReset", "value")
    }

    visitPropertyDefinition(path) {
      if (path.getValue().computed) {
        path.call(this, "visitWithoutReset", "key")
      }
      path.call(this, "visitWithoutReset", "value")
    }

    visitAwaitExpression(path) {
      const node = path.getValue()
      const { magicString, runtimeName } = this

      // Preserve nested import()/assignment rewrites inside the operand.
      magicString.overwrite(node.start, node.argument.start, `(yield ${runtimeName}.h(`)
      magicString.appendRight(node.end, "))")
      this.transforms |= TRANSFORMS_TOP_LEVEL_AWAIT
      this.visitChildren(path)
    }

    visitForOfStatement(path) {
      if (path.getValue().await) {
        throw new SyntaxError("Top-level for await...of is not yet supported by esm-sync")
      }
      this.visitChildren(path)
    }

    visitVariableDeclaration(path) {
      if (path.getValue().kind === "await using") {
        throw new SyntaxError("Top-level await using is not yet supported by esm-sync")
      }
      this.visitChildren(path)
    }
  }

  return new TopLevelAwaitVisitor()
}

export default shared.inited
  ? shared.module.topLevelAwaitVisitor
  : (shared.module.topLevelAwaitVisitor = init())
