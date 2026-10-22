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
    enable(parser) {
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
      parser.parseModuleExportName = wrap(parser.parseModuleExportName, parseModuleExportName)
      parser.parseExprAtom = wrap(parser.parseExprAtom, parseExprAtom)
      parser.parseNew = wrap(parser.parseNew, parseNew)
      parser.parseStatement = wrap(parser.parseStatement, parseStatement)
      parser.parseSubscript = wrap(parser.parseSubscript, parseSubscript)
      return parser
    }
  }

  function checkLVal(func, args) {
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

  function parseExport(func, args) {
    if (lookahead(this).type !== tt.star) {
      return Reflect.apply(func, this, args)
    }

    const [node, exported] = args

    this.next()

    const { start, startLoc } = this

    this.next()

    let finishType = "ExportAllDeclaration"

    if (this.eatContextual("as")) {
      const identifier = this.parseModuleExportName()

      this.checkExport(exported, identifier.name ?? identifier.value, identifier.start)

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

  function parseModuleExportName(func, args) {
    const name = Reflect.apply(func, this, args)

    if (name.type === "Literal" && hasUnpairedSurrogate(name.value)) {
      throw new errors.SyntaxError(this, name.start, INVALID_OR_UNEXPECTED_TOKEN)
    }

    return name
  }

  function parseWithClause(func, args) {
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

  function hasUnpairedSurrogate(value) {
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

  function parseExprAtom(func, args) {
    if (this.type === tt._import) {
      const { type } = lookahead(this)

      if (type === tt.dot) {
        return parseImportMetaPropertyAtom(this)
      }

      if (type === tt.parenL) {
        return parseImportCallAtom(this)
      }

      this.unexpected()
    }

    const node = Reflect.apply(func, this, args)
    const { type } = node

    if (type === tt._false || type === tt._null || type === tt._true) {
      node.raw = ""
    }

    return node
  }

  function parseNew(func, args) {
    const next = lookahead(this)

    if (next.type === tt._import && lookahead(next).type === tt.parenL) {
      this.unexpected()
    }

    return Reflect.apply(func, this, args)
  }

  function parseSubscript(func, args) {
    const [base, startPos, startLoc] = args

    if (base.type === "Import" && this.type === tt.parenL) {
      const callExpr = this.startNodeAt(startPos, startLoc)

      this.expect(tt.parenL)

      callExpr.arguments = [this.parseMaybeAssign()]
      callExpr.callee = base

      this.expect(tt.parenR)
      this.finishNode(callExpr, "CallExpression")

      args[0] = callExpr
    }

    return Reflect.apply(func, this, args)
  }

  function parseStatement(func, args) {
    const [, topLevel] = args

    if (this.type === tt._import) {
      const { start, type } = lookahead(this)

      if (type === tt.dot || type === tt.parenL) {
        const node = this.startNode()
        const expr = this.parseMaybeAssign()

        return this.parseExpressionStatement(node, expr)
      }

      if (!this.inModule || (!topLevel && !this.options.allowImportExportEverywhere)) {
        let message

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

  function parseImportCallAtom(parser) {
    const node = parser.startNode()

    parser.expect(tt._import)

    return parser.finishNode(node, "Import")
  }

  function parseImportMetaPropertyAtom(parser) {
    const node = parser.startNode()
    const meta = parser.parseIdent(true)

    node.meta = meta

    parser.expect(tt.dot)

    const { containsEsc } = parser
    const property = parser.parseIdent(true)

    node.property = property

    if (property.name !== "meta") {
      parser.raise(property.start, UNEXPECTED_IDENTIFIER)
    } else if (containsEsc) {
      parser.raise(property.start, INVALID_ESCAPED_RESERVED_WORD)
    } else if (!parser.inModule) {
      parser.raise(meta.start, ILLEGAL_IMPORT_META_OUTSIDE_MODULE)
    }

    return parser.finishNode(node, "MetaProperty")
  }

  return Plugin
}

export default shared.inited
  ? shared.module.acornParserImport
  : (shared.module.acornParserImport = init())
