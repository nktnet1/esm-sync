import type MagicString from "../magic-string.js"
type EditingVisitor = { magicString: InstanceType<typeof MagicString>; firstLineBreakPos?: number }
import pad from "./pad.js"
import shared from "../shared.js"

function init() {
  function overwrite(visitor: EditingVisitor, start: number, end: number, content: string) {
    const { magicString } = visitor
    const padded = pad(magicString.original, content, start, end)

    return magicString.overwrite(start, end, padded)
  }

  return overwrite
}

export default shared.inited
  ? shared.module.parseOverwrite
  : (shared.module.parseOverwrite = init())

export type CachedModule = ReturnType<typeof init>
