import shared from "../shared.js"
import stripQuotes from "../util/strip-quotes.js"

function init() {
  function lastArgMatch(
    args: string[] | null | undefined,
    pattern: RegExp,
    index = 1
  ): string | undefined {
    let length = args == null ? 0 : args.length

    while (length--) {
      const match = pattern.exec(args![length]!)

      if (match !== null) {
        return stripQuotes(match[index])
      }
    }
  }

  return lastArgMatch
}

export default shared.inited
  ? shared.module.envLastArgMatch
  : (shared.module.envLastArgMatch = init())

export type CachedModule = ReturnType<typeof init>
