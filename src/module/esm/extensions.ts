import type { ModuleRecord, RuntimeRequire } from "../../types/runtime.js"
import emptyRecord from "../../util/empty-record.js"
import SafeJSON from "../../safe/json.js"

import { dlopen } from "../../safe/process.js"
import { readFileSync } from "../../safe/fs.js"
import stripBOM from "../../util/strip-bom.js"
import toNamespacedPath from "../../path/to-namespaced-path.js"

const extensions = emptyRecord<RuntimeRequire["extensions"]>()

extensions[".js"] = function (mod: ModuleRecord, filename: string) {
  mod._compile(stripBOM(readFileSync(filename, "utf8")), filename)
}

extensions[".json"] = function (mod: ModuleRecord, filename: string) {
  const content = readFileSync(filename, "utf8")

  let exported: unknown

  try {
    exported = SafeJSON.parse(content)
  } catch (e) {
    if (typeof e === "object" && e !== null) {
      const error = e as { message: unknown }
      error.message = filename + ": " + error.message
    }

    throw e
  }

  mod.exports = exported
}

extensions[".node"] = function (mod: ModuleRecord, filename: string) {
  return dlopen(mod, toNamespacedPath(filename))
}

export default extensions
