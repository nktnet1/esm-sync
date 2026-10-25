import errors from "../parse/errors.js"
import shared from "../shared.js"

function init() {
  function isParseError(
    value: unknown
  ): value is Error & { column: number; line: number; inModule: boolean } {
    for (const name in errors) {
      if (value instanceof (errors as Record<string, new (...args: never[]) => Error>)[name]!) {
        return true
      }
    }

    return false
  }

  return isParseError
}

export default shared.inited
  ? shared.module.utilIsParseError
  : (shared.module.utilIsParseError = init())

export type CachedModule = ReturnType<typeof init>
