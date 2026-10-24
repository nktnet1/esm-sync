import Reflect from "../reflection.js"
import getPrototypeOf from "./get-prototype-of.js"
import setPrototypeOf from "./set-prototype-of.js"
import shared from "../shared.js"

function init() {
  const {
    Error: ExError,
    EvalError: ExEvalError,
    RangeError: ExRangeError,
    ReferenceError: ExReferenceError,
    SyntaxError: ExSyntaxError,
    TypeError: ExTypeError,
    URIError: ExURIError
  } = shared.external

  const protoMap = new Map([
    ["Error", ExError.prototype],
    ["EvalError", ExEvalError.prototype],
    ["RangeError", ExRangeError.prototype],
    ["ReferenceError", ExReferenceError.prototype],
    ["SyntaxError", ExSyntaxError.prototype],
    ["TypeError", ExTypeError.prototype],
    ["URIError", ExURIError.prototype]
  ])

  function toExternalError(error: unknown) {
    if (error instanceof Error) {
      const prototype = getPrototypeOf(error)
      const name = prototype === null ? void 0 : Reflect.get(prototype, "name")
      const proto = typeof name === "string" ? protoMap.get(name) : void 0

      if (proto !== void 0) {
        setPrototypeOf(error, proto)
      }
    }

    return error
  }

  return toExternalError
}

export default shared.inited
  ? shared.module.utilToExternalError
  : (shared.module.utilToExternalError = init())

export type CachedModule = ReturnType<typeof init>
