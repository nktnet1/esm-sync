import Reflect from "../../reflection.js"
import type { AcornParser, MethodWrapper } from "../../types/acorn.js"
import shared from "../../shared.js"
import wrap from "../../util/wrap.js"

function init() {
  const Plugin = {
    enable(parser: AcornParser) {
      parser.parseFunctionParams = wrap(parser.parseFunctionParams, parseFunctionParams)

      return parser
    }
  }

  const parseFunctionParams: MethodWrapper<"parseFunctionParams"> = function (func, args) {
    const [node] = args

    node.functionParamsStart = this.start

    return Reflect.apply(func, this, args)
  }

  return Plugin
}

export default shared.inited
  ? shared.module.acornParserFunctionParamsStart
  : (shared.module.acornParserFunctionParamsStart = init())

export type CachedModule = ReturnType<typeof init>
