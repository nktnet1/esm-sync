import ENTRY from "../../constant/entry.js"

import Entry from "../../entry.js"
import Loader from "../../loader.js"
import Module from "../../module.js"

import { readFileSync } from "../../safe/fs.js"
import getURLFromFilePath from "../../util/get-url-from-file-path.js"
import getURLQueryFragment from "../../util/get-url-query-fragment.js"
import has from "../../util/has.js"
import dualResolveFilename from "../internal/dual-resolve-filename.js"
import validateShallow from "./validate-shallow.js"

const { STATE_EXECUTION_COMPLETED, TYPE_ESM, UPDATE_TYPE_INIT } = ENTRY

// A text module is a synthetic ESM module with a single default string
// export. It must not be compiled or executed as JavaScript, even for .js.
function importText(request, parentEntry, setterArgsList) {
  const filename = dualResolveFilename(request, parentEntry.module)
  const queryFragment = getURLQueryFragment(request)
  const cacheKey =
    (queryFragment ? getURLFromFilePath(filename) + queryFragment : filename) + "\0text"
  const { moduleCache } = Loader.state.module

  let mod = has(moduleCache, cacheKey) ? moduleCache[cacheKey] : void 0
  let entry

  if (mod === void 0) {
    const source = readFileSync(filename, "utf8")

    mod = new Module(filename, parentEntry.module)
    mod.filename = filename
    mod.exports.default = source
    mod.loaded = true

    entry = Entry.get(mod)
    entry.type = TYPE_ESM
    entry.state = STATE_EXECUTION_COMPLETED
    entry.addGetter("default", () => source)
    entry.loaded()
    entry.updateBindings()

    moduleCache[cacheKey] = mod
  } else {
    entry = Entry.get(mod)
  }

  // Do not overwrite a regular JavaScript child from the same file.
  parentEntry.children[cacheKey] = entry
  entry.addSetters(setterArgsList, parentEntry)
  entry.updateBindings(null, UPDATE_TYPE_INIT)
  validateShallow(entry, parentEntry)
}

export default importText
