import shared from "../shared.js"
import { unlinkSync } from "../safe/fs.js"

function init() {
  function removeFile(filename: unknown) {
    if (typeof filename === "string") {
      try {
        unlinkSync(filename)
        return true
      } catch {}
    }

    return false
  }

  return removeFile
}

export default shared.inited ? shared.module.fsRemoveFile : (shared.module.fsRemoveFile = init())

export type CachedModule = ReturnType<typeof init>
