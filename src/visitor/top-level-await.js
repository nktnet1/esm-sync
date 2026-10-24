import COMPILER from "../constant/compiler.js"
import Visitor from "../visitor.js"
import getNamesFromPattern from "../parse/get-names-from-pattern.js"
import isShadowed from "../parse/is-shadowed.js"
import shared from "../shared.js"

function init() {
  const { TRANSFORMS_TOP_LEVEL_AWAIT } = COMPILER

  class TopLevelAwaitVisitor extends Visitor {
    reset(options) {
      this.magicString = options?.magicString
      this.possibleIndexes = options?.possibleIndexes
      this.runtimeName = options?.runtimeName
      this.top = options?.top
      this.assignableBindings = options?.assignableBindings
      this.importedBindings = options?.importedBindings
      this.checkImports = options?.checkImports
      this.scope = null
      this.names = new Set()
      this.shadowed = new Map()
      this.assignmentTargets = new Set()
      this.counter = 0
      this.prefixLength = 0
      this.transforms = 0
    }

    name() {
      let name
      do name = this.runtimeName + "$" + this.counter++
      while (this.names.has(name))
      this.names.add(name)
      return name
    }

    visitProgram(path) {
      const collect = (value) => {
        if (value === null || typeof value !== "object") return
        if (value.type === "Identifier") this.names.add(value.name)
        for (const key of Object.keys(value)) collect(value[key])
      }
      collect(path.getValue())
      this.visitScope(path, this.top.insertIndex, path.getValue().end, true)
    }

    visitBlockStatement(path) {
      const node = path.getValue()
      this.visitScope(path, node.start + 1, node.end - 1, false)
    }

    visitSwitchStatement(path) {
      const node = path.getValue()
      if (!node.cases.some((branch) => branch.consequent.some((child) => this.isUsing(child)))) {
        this.visitChildren(path)
        return
      }
      const previous = this.scope
      const scope = this.name()
      path.call(this, "visitWithoutReset", "discriminant")
      this.scope = scope
      path.call(this, "visitWithoutReset", "cases")
      this.magicString.prependRight(this.loopLabels(path).start, "{" + this.resourcePrefix(scope))
      this.magicString.appendLeft(node.end, this.resourceSuffix(scope) + "}")
      this.scope = previous
    }

    visitScope(path, start, end, program) {
      const previous = this.scope
      if (path.getValue().body.some((node) => this.isUsing(node))) {
        this.scope = this.name()
        const prefix = this.resourcePrefix(this.scope)
        // Module exports and imports must be hoisted INSIDE this try block:
        // their getters must share the original module's lexical environment.
        if (program) {
          this.magicString.prependLeft(start, prefix)
          this.prefixLength += prefix.length
        }
        this.visitChildren(path)
        if (!program) this.magicString.prependRight(start, prefix)
        this.magicString.appendLeft(end, this.resourceSuffix(this.scope))
      } else this.visitChildren(path)
      this.scope = previous
    }

    isUsing(node) {
      return (
        node?.type === "VariableDeclaration" &&
        (node.kind === "using" || node.kind === "await using")
      )
    }

    resourcePrefix(scope) {
      return `;const ${scope}=${this.runtimeName}.R();try{`
    }

    resourceSuffix(scope) {
      const error = this.name()
      return `\n}catch(${error}){${scope}.fail(${error})}finally{yield*${scope}.dispose();}`
    }

    // Only module-body awaits may become yields in the loader's generator.
    // Await expressions inside async functions must retain native semantics.
    visitFunctionDeclaration() {}
    visitFunctionExpression() {}
    visitArrowFunctionExpression() {}
    visitStaticBlock() {}

    visitVariableDeclarator(path) {
      path.call(this, "visitWithoutReset", "id")
      path.call(this, "visitWithoutReset", "init")
    }

    visitCatchClause(path) {
      path.call(this, "visitWithoutReset", "param")
      path.call(this, "visitWithoutReset", "body")
    }

    visitExpressionStatement(path) {
      const node = path.getValue()
      const parent = path.getParentNode()
      if (
        this.magicString.original.slice(node.start, node.start + 5) === "await" &&
        (parent.type === "Program" ||
          parent.type === "BlockStatement" ||
          parent.type === "SwitchCase")
      ) {
        // Replacing a statement-leading `await` with `(` must not turn the
        // preceding line into a call expression when its semicolon was omitted.
        this.magicString.prependLeft(node.start, ";")
      }
      this.visitChildren(path)
    }

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
      magicString.overwrite(node.start, node.start + 5, `(yield ${runtimeName}.h(`)
      magicString.appendLeft(node.end, "))")
      this.transforms |= TRANSFORMS_TOP_LEVEL_AWAIT
      this.visitChildren(path)
    }

    visitForOfStatement(path) {
      const node = path.getValue()
      const { left, right, body } = node
      const using = this.isUsing(left)
      if (!node.await) {
        if (!using) {
          this.visitChildren(path)
          return
        }
        const scope = this.name()
        const id = left.declarations[0].id
        this.magicString.overwrite(left.start, id.start, "const ")
        // Native for-of performs IteratorClose for errors in this body,
        // including failed resource acquisition and per-iteration disposal.
        path.call(this, "visitWithoutReset", "right")
        path.call(this, "visitWithoutReset", "body")
        this.magicString.prependRight(
          body.start,
          `{${this.resourcePrefix(scope)}${scope}.add(${id.name},${left.kind === "await using"});`
        )
        this.magicString.appendLeft(body.end, this.resourceSuffix(scope) + "}")
        this.transforms |= TRANSFORMS_TOP_LEVEL_AWAIT
        return
      }

      const { magicString, runtimeName } = this
      const iterator = this.name()
      const step = this.name()
      const abrupt = this.name()
      const failed = this.name()
      const failure = this.name()
      const error = this.name()
      const scope = using ? this.name() : null
      const declarator = left.type === "VariableDeclaration"
      const pattern = declarator ? left.declarations[0].id : left
      const names = getNamesFromPattern(pattern)
      const lexical = declarator && left.kind !== "var"
      const labels = this.loopLabels(path)
      this.visitChildren(path)

      // Keep the original RHS and binding pattern, with all import/await/TDZ
      // edits attached. The RHS runs in the lexical head's TDZ; each iteration
      // then gets a fresh binding and retains the original body block's scope.
      const prefix = `{let ${iterator},${step},${abrupt}=false,${failed}=false,${failure};${iterator}=${runtimeName}.A((`
      magicString.overwrite(labels.start, left.start, prefix)
      magicString.overwrite(left.end, right.start, "")
      magicString.move(left.start, left.end, body.start)
      magicString.overwrite(
        right.end,
        body.start,
        `));${lexical && names.length !== 0 ? "let " + names.join(",") + ";" : ""}try{${labels.code}for(;!${iterator}.done(${step}=yield ${runtimeName}.h(${iterator}.next()));${abrupt}=false){${step}=${iterator}.value(${step});${abrupt}=true;` +
          (using ? this.resourcePrefix(scope) : "")
      )

      if (using) {
        magicString.overwrite(left.start, pattern.start, "const ")
      }
      let assignment = `=${using ? scope + ".add(" : ""}${step}${using ? "," + (left.kind === "await using") + ")" : ""}`
      let assignmentPrefix = declarator ? "" : "("
      let assignmentSuffix = declarator ? ";" : ");"
      if (!declarator || left.kind === "var") {
        if (
          this.checkImports &&
          names.some(
            (name) => this.importedBindings.has(name) && !isShadowed(path, name, this.shadowed)
          )
        ) {
          this.importedTargets(path, pattern)
        }
        if (
          names.some(
            (name) => this.assignableBindings.has(name) && !isShadowed(path, name, this.shadowed)
          )
        ) {
          // var declarations can be exported module bindings too.
          assignmentPrefix = declarator ? "try{" : "try{("
          assignmentSuffix = (declarator ? ";" : ");") + `}finally{${runtimeName}.u()}`
        }
      }
      magicString.prependRight(left.start, assignmentPrefix)
      magicString.appendLeft(left.end, assignment + assignmentSuffix)
      magicString.appendLeft(
        node.end,
        (using ? this.resourceSuffix(scope) : "") +
          `\n}}catch(${error}){${failed}=true;${failure}=${error}}finally{try{if(${abrupt})yield*${iterator}.close()}finally{if(${failed})throw ${failure}}}}`
      )
      this.transforms |= TRANSFORMS_TOP_LEVEL_AWAIT
    }

    importedTargets(path, node, shorthand = false) {
      if (node === null) return
      if (node.type === "Identifier") {
        if (this.importedBindings.has(node.name) && !isShadowed(path, node.name, this.shadowed)) {
          this.assignmentTargets.add(node)
          this.magicString.overwrite(
            node.start,
            node.end,
            (shorthand ? JSON.stringify(node.name) + ":" : "") +
              `${this.runtimeName}.B(${JSON.stringify(node.name)}).value`
          )
        }
      } else if (node.type === "Property") this.importedTargets(path, node.value, node.shorthand)
      else if (node.type === "AssignmentPattern") this.importedTargets(path, node.left, shorthand)
      else if (node.type === "RestElement") this.importedTargets(path, node.argument)
      else if (node.type === "ObjectPattern" || node.type === "ArrayPattern") {
        for (const child of node.properties || node.elements) this.importedTargets(path, child)
      }
    }

    loopLabels(path) {
      let node = path.getValue()
      const labels = []
      path.getParentNode((parent) => {
        if (parent.type !== "LabeledStatement" || parent.body !== node) return true
        labels.unshift(parent.label.name + ":")
        node = parent
        return false
      })
      return { start: node.start, code: labels.join("") }
    }

    visitForStatement(path) {
      if (this.isUsing(path.getValue().init)) {
        const previous = this.scope
        const scope = (this.scope = this.name())
        this.magicString.prependRight(this.loopLabels(path).start, "{" + this.resourcePrefix(scope))
        this.visitChildren(path)
        this.magicString.appendLeft(path.getValue().end, this.resourceSuffix(scope) + "}")
        this.scope = previous
        return
      }
      this.visitChildren(path)
    }

    visitVariableDeclaration(path) {
      const node = path.getValue()
      this.visitChildren(path)
      // For-of bindings are lowered by visitForOfStatement, after traversal.
      if (this.isUsing(node) && path.getParentNode()?.type !== "ForOfStatement") {
        this.magicString.overwrite(node.start, node.declarations[0].id.start, "const ")
        for (const { id, init } of node.declarations) {
          const anonymous =
            init.type === "ArrowFunctionExpression" ||
            ((init.type === "FunctionExpression" || init.type === "ClassExpression") &&
              init.id === null)
          const key = JSON.stringify(id.name)
          this.magicString.prependRight(
            init.start,
            `${this.scope}.add((${anonymous ? "{[" + key + "]:" : ""}`
          )
          this.magicString.appendLeft(
            init.end,
            `${anonymous ? "}[" + key + "]" : ""}),${node.kind === "await using"})`
          )
        }
        this.transforms |= TRANSFORMS_TOP_LEVEL_AWAIT
      }
    }
  }

  return new TopLevelAwaitVisitor()
}

export default shared.inited
  ? shared.module.topLevelAwaitVisitor
  : (shared.module.topLevelAwaitVisitor = init())
