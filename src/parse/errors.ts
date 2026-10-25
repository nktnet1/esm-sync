import Reflect from "../reflection.js"
import type { AcornParser } from "../types/acorn.js"
import { getLineInfo } from "../acorn.js"
import shared from "../shared.js"

function init() {
  function createClass(Super: ErrorConstructor) {
    class AcornError extends Super {
      column: number
      inModule: boolean
      line: number
      constructor(parser: Pick<AcornParser, "input" | "inModule">, pos: number, message: string) {
        super(message)

        const { column, line } = getLineInfo(parser.input, pos)

        this.column = column
        this.inModule = parser.inModule
        this.line = line
      }
    }

    Reflect.defineProperty(AcornError, "name", {
      configurable: true,
      value: Super.name
    })

    return AcornError
  }

  return {
    ReferenceError: createClass(ReferenceError),
    SyntaxError: createClass(SyntaxError)
  }
}

export default shared.inited ? shared.module.parseErrors : (shared.module.parseErrors = init())

export type CachedModule = ReturnType<typeof init>
