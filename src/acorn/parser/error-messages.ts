import type { AcornParser, AstNode } from "../../types/acorn.js"
import MESSAGE from "../../constant/message.js"

import errors from "../../parse/errors.js"
import shared from "../../shared.js"
import { tokTypes as tt } from "../../acorn.js"

function init() {
  const {
    ILLEGAL_AWAIT_IN_NON_ASYNC_FUNCTION,
    ILLEGAL_HTML_COMMENT,
    ILLEGAL_IMPORT_META_OUTSIDE_MODULE,
    ILLEGAL_NEW_TARGET,
    ILLEGAL_RETURN_STATEMENT,
    INVALID_ESCAPED_RESERVED_WORD,
    INVALID_OR_UNEXPECTED_TOKEN,
    UNEXPECTED_EOS,
    UNEXPECTED_EVAL_OR_ARGUMENTS,
    UNEXPECTED_IDENTIFIER,
    UNEXPECTED_RESERVED_WORD,
    UNEXPECTED_STRICT_MODE_RESERVED_WORD,
    UNEXPECTED_STRING,
    UNEXPECTED_TOKEN,
    UNTERMINATED_ARGUMENTS_LIST,
    UNTERMINATED_TEMPLATE
  } = MESSAGE

  const ENGINE_DUPLICATE_EXPORT = "Duplicate export of '"
  const PARSER_DUPLICATE_EXPORT = "Duplicate export '"

  const PARSER_IMPORT_EXPORT_INVALID_LEVEL =
    "'import' and 'export' may only appear at the top level"
  const PARSER_IMPORT_EXPORT_OUTSIDE_MODULE =
    "'import' and 'export' may appear only with 'sourceType: module'"
  const PARSER_INVALID_ESCAPED_RESERVED_WORD = "Escape sequence in keyword "

  const messageLookup = new Set([
    ILLEGAL_AWAIT_IN_NON_ASYNC_FUNCTION,
    ILLEGAL_HTML_COMMENT,
    ILLEGAL_IMPORT_META_OUTSIDE_MODULE,
    ILLEGAL_NEW_TARGET,
    ILLEGAL_RETURN_STATEMENT,
    INVALID_ESCAPED_RESERVED_WORD,
    INVALID_OR_UNEXPECTED_TOKEN,
    UNEXPECTED_EOS,
    UNEXPECTED_EVAL_OR_ARGUMENTS,
    UNEXPECTED_IDENTIFIER,
    UNEXPECTED_RESERVED_WORD,
    UNEXPECTED_STRICT_MODE_RESERVED_WORD,
    UNEXPECTED_STRING,
    UNEXPECTED_TOKEN,
    UNTERMINATED_ARGUMENTS_LIST,
    UNTERMINATED_TEMPLATE
  ])

  const replacementMap = new Map([
    ["'return' outside of function", ILLEGAL_RETURN_STATEMENT],
    ["Binding arguments in strict mode", UNEXPECTED_EVAL_OR_ARGUMENTS],
    ["Binding await in strict mode", UNEXPECTED_RESERVED_WORD],
    ["Cannot use keyword 'await' outside an async function", ILLEGAL_AWAIT_IN_NON_ASYNC_FUNCTION],
    ["The keyword 'await' is reserved", UNEXPECTED_RESERVED_WORD],
    ["The keyword 'yield' is reserved", UNEXPECTED_STRICT_MODE_RESERVED_WORD],
    ["Unterminated string constant", INVALID_OR_UNEXPECTED_TOKEN],
    ["Unterminated template", UNTERMINATED_TEMPLATE],

    // Acorn v8.4.1 and below
    ["'new.target' can only be used in functions", ILLEGAL_NEW_TARGET],
    // Acorn v8.5.0 and above
    ["'new.target' can only be used in functions and class static block", ILLEGAL_NEW_TARGET]
  ])

  const Plugin = {
    enable(parser: AcornParser) {
      parser.parseExprList = parseExprList
      parser.raise = raise
      parser.raiseRecoverable = raise
      parser.unexpected = unexpected

      return parser
    }
  }

  const parseExprList: AcornParser["parseExprList"] = function (
    this: AcornParser,
    close,
    allowTrailingComma,
    allowEmpty,
    refDestructuringErrors
  ) {
    const elements: (AstNode | null)[] = []

    let first = true

    while (!this.eat(close)) {
      if (!first) {
        if (allowEmpty || close !== tt.parenR) {
          this.expect(tt.comma)
        } else if (!this.eat(tt.comma)) {
          this.raise(this.start, UNTERMINATED_ARGUMENTS_LIST)
        }

        if (allowTrailingComma && this.afterTrailingComma(close)) {
          break
        }
      } else {
        first = false
      }

      let element: AstNode | null

      if (allowEmpty && this.type === tt.comma) {
        element = null
      } else if (this.type === tt.ellipsis) {
        element = this.parseSpread(refDestructuringErrors)

        if (
          refDestructuringErrors &&
          this.type === tt.comma &&
          refDestructuringErrors.trailingComma === -1
        ) {
          refDestructuringErrors.trailingComma = this.start
        }
      } else {
        element = this.parseMaybeAssign(false, refDestructuringErrors)
      }

      elements.push(element)
    }

    return elements
  }

  function raise(this: AcornParser, pos: number, message: string): void {
    if (replacementMap.has(message)) {
      message = replacementMap.get(message)!
    } else if (
      message === PARSER_IMPORT_EXPORT_INVALID_LEVEL ||
      message === PARSER_IMPORT_EXPORT_OUTSIDE_MODULE
    ) {
      message = UNEXPECTED_TOKEN + " " + this.type.label
    } else if (message.startsWith(PARSER_DUPLICATE_EXPORT)) {
      message = message.replace(PARSER_DUPLICATE_EXPORT, ENGINE_DUPLICATE_EXPORT)
    } else if (message.startsWith(PARSER_INVALID_ESCAPED_RESERVED_WORD)) {
      message = INVALID_ESCAPED_RESERVED_WORD
    } else if (!messageLookup.has(message) && !message.startsWith(UNEXPECTED_TOKEN)) {
      return
    }

    throw new errors.SyntaxError(this, pos, message)
  }

  function unexpected(this: AcornParser, pos?: number): never {
    if (pos === void 0) {
      pos = this.start
    }

    const message = this.type === tt.eof ? UNEXPECTED_EOS : INVALID_OR_UNEXPECTED_TOKEN

    throw new errors.SyntaxError(this, pos, message)
  }

  return Plugin
}

export default shared.inited
  ? shared.module.acornParserErrorMessages
  : (shared.module.acornParserErrorMessages = init())

export type CachedModule = ReturnType<typeof init>
