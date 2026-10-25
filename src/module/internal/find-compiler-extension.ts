import type { RuntimeRequire } from "../../types/runtime.js"
import type Entry from "../../entry.js"
import has from "../../util/has.js"
import shared from "../../shared.js"

function init() {
  function findCompilerExtension(extCompilers: RuntimeRequire["extensions"], entry: Entry) {
    const basename = entry.basename!,
      extname = entry.extname!,
      filename = entry.filename!

    if (extname === "") {
      return extname
    }

    const extIndex = filename.length - extname.length

    let index: number
    let fromIndex = 0

    while ((index = basename.indexOf(".", fromIndex)) !== -1) {
      fromIndex = index + 1

      if (index === 0) {
        continue
      }

      const done = index === extIndex

      const ext = done ? extname : basename.slice(index)

      if (has(extCompilers, ext)) {
        return ext
      }

      if (done) {
        break
      }
    }

    return ""
  }

  return findCompilerExtension
}

export default shared.inited
  ? shared.module.moduleInternalFindCompilerExtension
  : (shared.module.moduleInternalFindCompilerExtension = init())

export type CachedModule = ReturnType<typeof init>
