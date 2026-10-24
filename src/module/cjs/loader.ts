import type Entry from "../../entry.js"
import Module from "../../module.js"

import findCompilerExtension from "../internal/find-compiler-extension.js"

function loader(entry: Entry, filename: string) {
  entry.updateFilename(filename)

  let foundExt = findCompilerExtension(Module._extensions, entry)

  if (foundExt === "") {
    foundExt = ".js"
  }

  const mod = entry.module

  mod.paths = Module._nodeModulePaths(entry.dirname!)

  Module._extensions[foundExt]!(mod, filename)

  if (!mod.loaded) {
    mod.loaded = true
    entry.loaded()
  }
}

export default loader
