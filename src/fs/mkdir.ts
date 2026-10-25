import { mkdirSync } from "../safe/fs.js"
import shared from "../shared.js"

function init() {
  function mkdir(dirPath: unknown) {
    if (typeof dirPath === "string") {
      try {
        mkdirSync(dirPath)
        return true
      } catch {}
    }

    return false
  }

  return mkdir
}

export default shared.inited ? shared.module.fsMkdir : (shared.module.fsMkdir = init())

export type CachedModule = ReturnType<typeof init>
