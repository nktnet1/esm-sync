import Reflect from "../../reflection.js"
import type { AcornParser, MethodWrapper } from "../../types/acorn.js"
// A loose implementation of BigInt syntax.
// https://github.com/tc39/proposal-bigint

import CHAR_CODE from "../../constant/char-code.js"

import shared from "../../shared.js"
import { tokTypes as tt } from "../../acorn.js"
import wrap from "../../util/wrap.js"

function init() {
  const { LOWERCASE_N } = CHAR_CODE

  const Plugin = {
    enable(parser: AcornParser) {
      parser.readNumber = wrap(parser.readNumber, readNumber)
      parser.readRadixNumber = wrap(parser.readRadixNumber, readRadixNumber)

      return parser
    }
  }

  function readBigInt(parser: AcornParser, radix?: number) {
    const { pos } = parser

    if (typeof radix === "number") {
      parser.pos += 2
    } else {
      radix = 10
    }

    if (parser.readInt(radix) !== null && parser.input.charCodeAt(parser.pos) === LOWERCASE_N) {
      ++parser.pos

      return parser.finishToken(tt.num, null)
    }

    parser.pos = pos

    return null
  }

  const readNumber: MethodWrapper<"readNumber"> = function (func, args) {
    const [startsWithDot] = args

    if (!startsWithDot) {
      const result = readBigInt(this)

      if (result !== null) {
        return result
      }
    }

    return Reflect.apply(func, this, args)
  }

  const readRadixNumber: MethodWrapper<"readRadixNumber"> = function (func, args) {
    const [radix] = args
    const result = readBigInt(this, radix)

    return result === null ? Reflect.apply(func, this, args) : result
  }

  return Plugin
}

export default shared.inited
  ? shared.module.acornParserBigInt
  : (shared.module.acornParserBigInt = init())

export type CachedModule = ReturnType<typeof init>
