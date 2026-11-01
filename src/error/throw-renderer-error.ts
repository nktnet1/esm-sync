import SafeBuffer from "../safe/buffer.js"
import SafeJSON from "../safe/json.js"
import { Script } from "../safe/vm.js"
import getLocationFromStackTrace from "./get-location-from-stack-trace.js"
import get from "../util/get.js"
import getModuleURL from "../util/get-module-url.js"
import readFile from "../fs/read-file.js"

// Chromium reports the last explicit throw site separately from an Error's
// captured frames. Keep the same error, but throw it from its original source.
export default function throwRendererError(error: unknown): never {
  let rethrow: ((error: unknown) => never) | undefined
  try {
    rethrow = createThrower(error)
  } catch {
    // A missing location or unsupported VM must not replace the user's error.
  }
  if (rethrow !== void 0) return rethrow(error)
  throw error
}

function createThrower(error: unknown): ((error: unknown) => never) | undefined {
  const location = getLocationFromStackTrace(error)
  const stack = get(error, "stack")
  if (location === null || typeof stack !== "string") return
  const { filename } = location
  let line = Number(location.line)
  let column = Number(location.column) - 1
  const arrow = /^[^\n]+\n[^\n]*\n( *)\^/.exec(stack)
  if (arrow !== null) column = arrow[1]!.length
  else {
    const frames = /^ *at (?:.+? \()?(.+?):(\d+):(\d+)\)?$/gm
    let frame: RegExpExecArray | null
    while ((frame = frames.exec(stack)) !== null) {
      if (frame[1] === filename) {
        line = Number(frame[2])
        column = Number(frame[3]) - 1
        break
      }
    }
  }
  // Error.stack can be supplied by user code. Reject invalid VM offsets before
  // encoding them, including Infinity from an excessively long digit string.
  if (!Number.isInteger(line) || line < 1 || line > 0x7fffffff) return
  if (!Number.isInteger(column) || column < 0 || column > 0x7fffffff) column = 0
  const prefix = "(function(error){"
  const map = SafeJSON.stringify({
    version: 3,
    sources: [getModuleURL(filename)],
    sourcesContent: [readFile(filename, "utf8") ?? ""],
    names: [],
    mappings: vlq(prefix.length) + "A" + vlq(line - 1) + vlq(column)
  })
  return new Script(
    prefix +
      "throw error})\n//# sourceMappingURL=data:application/json;base64," +
      SafeBuffer.from(map).toString("base64"),
    { filename, lineOffset: line - 1, columnOffset: column - prefix.length }
  ).runInThisContext() as (error: unknown) => never
}

function vlq(value: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let remaining = value * 2
  let result = ""
  do {
    const digit = remaining % 32
    remaining = Math.floor(remaining / 32)
    result += alphabet[digit + (remaining ? 32 : 0)]
  } while (remaining)
  return result
}
