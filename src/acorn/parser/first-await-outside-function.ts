import Reflect from "../../reflection.js"
import type { AcornParser, MethodWrapper } from "../../types/acorn.js"
import { getLineInfo } from "../../acorn.js"
import lookahead from "../../parse/lookahead.js"
import shared from "../../shared.js"
import wrap from "../../util/wrap.js"

function init() {
  const Plugin = {
    enable(parser: AcornParser) {
      parser.firstAwaitOutsideFunction = null
      parser.parseAwait = wrap(parser.parseAwait, parseAwait)
      parser.parseForStatement = wrap(parser.parseForStatement, parseForStatement)
      parser.parseVar = wrap(parser.parseVar, parseVar)

      return parser
    }
  }

  const parseAwait: MethodWrapper<"parseAwait"> = function (func, args) {
    if (!this.inAsync && !this.inFunction && this.firstAwaitOutsideFunction === null) {
      this.firstAwaitOutsideFunction = getLineInfo(this.input, this.start)
    }

    return Reflect.apply(func, this, args)
  }

  const parseForStatement: MethodWrapper<"parseForStatement"> = function (func, args) {
    if (this.inAsync || this.inFunction || this.firstAwaitOutsideFunction !== null) {
      return Reflect.apply(func, this, args)
    }

    const [node] = args
    const { start } = lookahead(this)
    const result = Reflect.apply(func, this, args)

    if (node.await && this.firstAwaitOutsideFunction === null) {
      this.firstAwaitOutsideFunction = getLineInfo(this.input, start)
    }

    return result
  }

  const parseVar: MethodWrapper<"parseVar"> = function (func, args) {
    if (args[2] === "await using" && !this.inFunction && this.firstAwaitOutsideFunction === null) {
      this.firstAwaitOutsideFunction = getLineInfo(this.input, args[0].start)
    }
    return Reflect.apply(func, this, args)
  }

  return Plugin
}

export default shared.inited
  ? shared.module.acornParserFirstAwaitOutSideFunction
  : (shared.module.acornParserFirstAwaitOutSideFunction = init())

export type CachedModule = ReturnType<typeof init>
