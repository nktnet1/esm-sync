import Reflect from "../../reflection.js"
import type { AcornParser, MethodWrapper } from "../../types/acorn.js"
// Parser support for dynamic import and import meta property syntax.
// https://github.com/tc39/proposal-dynamic-import
// https://github.com/tc39/proposal-import-meta
//
// Dynamic import syntax is based on acorn-dynamic-import.
// Copyright Jordan Gensler. Released under MIT license:
// https://github.com/kesne/acorn-dynamic-import
//
// Import meta property syntax is adapted from babel-parser.
// Copyright Sebastian McKenzie and other contributors. Released under MIT license:
// https://github.com/babel/babel/blob/master/packages/babel-parser/src/parser/expression.js

import MESSAGE from "../../constant/message.js"

import errors from "../../parse/errors.js"
import lookahead from "../../parse/lookahead.js"
import shared from "../../shared.js"
import { tokTypes as tt } from "../../acorn.js"
import wrap from "../../util/wrap.js"

function init() {
  const {
    ILLEGAL_IMPORT_META_OUTSIDE_MODULE,
    INVALID_ESCAPED_RESERVED_WORD,
    INVALID_IMPORT_META_ASSIGNMENT,
    INVALID_LEFT_HAND_SIDE_ASSIGNMENT,
    INVALID_OR_UNEXPECTED_TOKEN,
    UNEXPECTED_IDENTIFIER,
    UNEXPECTED_STRING,
    UNEXPECTED_TOKEN
  } = MESSAGE

  const Plugin = {
    enable(parser: AcornParser) {
      // Allow `yield import()` to parse.
      tt._import.startsExpr = true

      // Acorn 8.19 validates assignment targets through checkLValSimple,
      // not the older checkLVal method. Preserve both entry points.
      if (typeof parser.checkLVal === "function") {
        parser.checkLVal = wrap(parser.checkLVal, checkLVal)
      }

      if (typeof parser.checkLValSimple === "function") {
        parser.checkLValSimple = wrap(parser.checkLValSimple, checkLVal)
      }
      if (typeof parser.parseWithClause === "function") {
        parser.parseWithClause = wrap(parser.parseWithClause, parseWithClause)
      }
      parser.parseExport = wrap(parser.parseExport, parseExport)
      parser.parseImport = wrap(parser.parseImport, parseImport)
      parser.parseModuleExportName = wrap(parser.parseModuleExportName, parseModuleExportName)
      parser.parseExprAtom = wrap(parser.parseExprAtom, parseExprAtom)
      parser.parseNew = wrap(parser.parseNew, parseNew)
      parser.parseStatement = wrap(parser.parseStatement, parseStatement)
      parser.parseSubscript = wrap(parser.parseSubscript, parseSubscript)
      return parser
    }
  }

  const checkLVal: MethodWrapper<"checkLValSimple"> = function (func, args) {
    const [expr] = args
    const exprType = expr.type
    const { start } = expr

    if (exprType === "CallExpression" && expr.callee.type === "Import") {
      throw new errors.SyntaxError(this, start, INVALID_LEFT_HAND_SIDE_ASSIGNMENT)
    }

    if (
      exprType === "MetaProperty" &&
      expr.meta.name === "import" &&
      expr.property.name === "meta"
    ) {
      throw new errors.SyntaxError(this, start, INVALID_IMPORT_META_ASSIGNMENT)
    }

    return Reflect.apply(func, this, args)
  }

  const parseImport: MethodWrapper<"parseImport"> = function (func, args) {
    const ahead = lookahead(this)
    const binding = lookahead(ahead)
    const deferred = ahead.value === "defer" && binding.type === tt.star
    const source =
      ahead.value === "source" &&
      binding.type === tt.name &&
      (binding.value !== "from" || lookahead(binding).type !== tt.string)
    // `import source from "mod"` remains an ordinary default import.
    if (ahead.containsEsc || (!deferred && !source)) {
      return Reflect.apply(func, this, args)
    }

    const [node] = args
    this.next()
    this.next()
    node.phase = source ? "source" : "defer"
    node.specifiers = [
      source ? this.parseImportDefaultSpecifier() : this.parseImportNamespaceSpecifier()
    ]
    this.expectContextual("from")
    if (this.type !== tt.string) this.unexpected()
    node.source = this.parseExprAtom()
    node.attributes = this.options.ecmaVersion >= 16 ? this.parseWithClause() : []
    this.semicolon()
    return this.finishNode(node, "ImportDeclaration")
  }

  const parseExport: MethodWrapper<"parseExport"> = function (func, args) {
    if (lookahead(this).type !== tt.star) {
      const declaration = Reflect.apply(func, this, args)
      if (declaration.type === "ExportNamedDeclaration" && declaration.source === null) {
        for (const specifier of declaration.specifiers) {
          if (specifier.type === "ExportSpecifier" && specifier.local.type !== "Identifier") {
            throw new errors.SyntaxError(
              this,
              specifier.local.start,
              "A string literal cannot be used as an exported binding without `from`"
            )
          }
        }
      }
      return declaration
    }

    const [node, exported] = args

    this.next()

    const { start, startLoc } = this

    this.next()

    let finishType: "ExportAllDeclaration" | "ExportNamedDeclaration" = "ExportAllDeclaration"

    if (this.eatContextual("as")) {
      const identifier = this.parseModuleExportName()

      this.checkExport(
        exported,
        identifier.type === "Identifier" ? identifier.name : identifier.value,
        identifier.start
      )

      const specifier = this.startNodeAt(start, startLoc)

      finishType = "ExportNamedDeclaration"

      specifier.exported = identifier
      node.declaration = null
      node.specifiers = [this.finishNode(specifier, "ExportNamespaceSpecifier")]
    }

    this.expectContextual("from")

    if (this.type !== tt.string) {
      this.unexpected()
    }

    node.source = this.parseExprAtom()

    if (this.options.ecmaVersion >= 16) {
      node.attributes = this.parseWithClause()
    }

    this.semicolon()

    return this.finishNode(node, finishType)
  }

  const parseModuleExportName: MethodWrapper<"parseModuleExportName"> = function (func, args) {
    const name = Reflect.apply(func, this, args)

    if (name.type === "Literal" && hasUnpairedSurrogate(name.value)) {
      throw new errors.SyntaxError(this, name.start, INVALID_OR_UNEXPECTED_TOKEN)
    }

    return name
  }

  const parseWithClause: MethodWrapper<"parseWithClause"> = function (func, args) {
    const attributes = Reflect.apply(func, this, args)

    if (attributes.length < 2) {
      return attributes
    }

    const keys = new Set()

    // Acorn's duplicate-key error can be suppressed by parser tolerance.
    // Validate parsed values, not raw spellings, and do not use an object as
    // a key table (`__proto__` must be treated like every other string).
    for (const attribute of attributes) {
      const { key } = attribute
      const name = key.type === "Identifier" ? key.name : key.value

      if (keys.has(name)) {
        throw new errors.SyntaxError(this, key.start, "Duplicate attribute key '" + name + "'")
      }

      keys.add(name)
    }

    return attributes
  }

  function hasUnpairedSurrogate(value: unknown) {
    if (typeof value !== "string") return false
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)

      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++index)

        if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return true
      }
    }

    return false
  }

  const parseExprAtom: MethodWrapper<"parseExprAtom"> = function (func, args) {
    if (this.type === tt._import) {
      const { type } = lookahead(this)

      if (type === tt.dot) {
        return parseImportPropertyAtom(this)
      }

      if (type === tt.parenL) {
        return parseImportCallAtom(this)
      }

      this.unexpected()
    }

    const node = Reflect.apply(func, this, args)

    return node
  }

  const parseNew: MethodWrapper<"parseNew"> = function (func, args) {
    const next = lookahead(this)

    if (next.type === tt._import) {
      const afterImport = lookahead(next)

      if (afterImport.type === tt.parenL) {
        this.unexpected()
      }

      if (afterImport.type === tt.dot) {
        const phase = lookahead(afterImport)

        if (phase.value === "source" || phase.value === "defer") {
          // `new import.source()` and `new import.defer()` are invalid, but
          // `new import.meta.foo()` remains a normal constructor expression.
          this.unexpected()
        }
      }
    }

    return Reflect.apply(func, this, args)
  }

  const parseSubscript: MethodWrapper<"parseSubscript"> = function (func, args) {
    const [base, startPos, startLoc] = args

    if (base.type === "Import") {
      // The phase-qualified forms are call expressions, not properties of an
      // `import` object. `import.source` and `import.defer` alone are invalid.
      if (this.type !== tt.parenL) {
        this.unexpected()
      }

      const callExpr = this.startNodeAt(startPos, startLoc)

      this.expect(tt.parenL)

      const callArguments = [this.parseMaybeAssign()]

      if (this.eat(tt.comma) && this.type !== tt.parenR) {
        callArguments.push(this.parseMaybeAssign())
        this.eat(tt.comma)
      }

      callExpr.arguments = callArguments
      callExpr.callee = base

      this.expect(tt.parenR)
      const result = this.finishNode(callExpr, "CallExpression")

      args[0] = result
    }

    return Reflect.apply(func, this, args)
  }

  const parseStatement: MethodWrapper<"parseStatement"> = function (func, args) {
    const [, topLevel] = args

    if (this.type === tt._import) {
      const { start, type } = lookahead(this)

      if (type === tt.dot || type === tt.parenL) {
        const node = this.startNode()
        const expr = this.parseMaybeAssign()

        return this.parseExpressionStatement(node, expr)
      }

      if (!this.inModule || (!topLevel && !this.options.allowImportExportEverywhere)) {
        let message: string

        if (type === tt.name) {
          message = UNEXPECTED_IDENTIFIER
        } else if (type === tt.string) {
          message = UNEXPECTED_STRING
        } else {
          message = UNEXPECTED_TOKEN + " " + type.label
        }

        this.raise(start, message)
      }
    }

    return Reflect.apply(func, this, args)
  }

  function parseImportCallAtom(parser: AcornParser) {
    const node = parser.startNode()

    parser.expect(tt._import)

    return parser.finishNode(node, "Import")
  }

  function parseImportPropertyAtom(parser: AcornParser) {
    const node = parser.startNode()
    const meta = parser.parseIdent(true)

    parser.expect(tt.dot)

    const { containsEsc } = parser
    const property = parser.parseIdent(true)

    if (property.name === "source" || property.name === "defer") {
      if (containsEsc) {
        parser.raise(property.start, INVALID_ESCAPED_RESERVED_WORD)
      }

      node.phase = property.name
      return parser.finishNode(node, "Import")
    }

    if (property.name !== "meta") {
      parser.raise(property.start, UNEXPECTED_IDENTIFIER)
    } else if (containsEsc) {
      parser.raise(property.start, INVALID_ESCAPED_RESERVED_WORD)
    } else if (!parser.inModule) {
      parser.raise(meta.start, ILLEGAL_IMPORT_META_OUTSIDE_MODULE)
    }

    node.meta = meta
    node.property = property

    return parser.finishNode(node, "MetaProperty")
  }

  return Plugin
}

export default shared.inited
  ? shared.module.acornParserImport
  : (shared.module.acornParserImport = init())

export type CachedModule = ReturnType<typeof init>
