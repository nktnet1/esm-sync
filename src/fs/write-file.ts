import shared from "../shared.js"
import { writeFileSync } from "../safe/fs.js"

function init() {
  function writeFile(
    filename: string,
    bufferOrString: string | Uint8Array,
    options?: import("node:fs").WriteFileOptions
  ) {
    if (typeof filename === "string") {
      try {
        writeFileSync(filename, bufferOrString, options)
        return true
      } catch {}
    }

    return false
  }

  return writeFile
}

export default shared.inited ? shared.module.fsWriteFile : (shared.module.fsWriteFile = init())

export type CachedModule = ReturnType<typeof init>
