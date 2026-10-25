import { readFileSync } from "../safe/fs.js"
import shared from "../shared.js"
import stripBOM from "../util/strip-bom.js"

function init() {
  function readFile(filename: string, options: BufferEncoding): string | null
  function readFile(filename: string, options?: null): Buffer | null
  function readFile(filename: string, options?: BufferEncoding | null): string | Buffer | null {
    let content: string | Buffer | null = null

    try {
      content = options == null ? readFileSync(filename) : readFileSync(filename, options)
    } catch {}

    if (typeof content === "string" && options === "utf8") {
      return stripBOM(content)
    }

    return content
  }

  return readFile
}

export default shared.inited ? shared.module.fsReadFile : (shared.module.fsReadFile = init())

export type CachedModule = ReturnType<typeof init>
