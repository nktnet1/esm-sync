import builtinLookup from "../builtin-lookup.js"
import ENV from "../constant/env.js"
import { dirname, isAbsolute } from "../safe/path.js"
import getFilePathfromURL from "./get-file-path-from-url.js"
import isFileOrigin from "./is-file-origin.js"
import isObject from "./is-object.js"
import shared from "../shared.js"

function init() {
  const { ELECTRON_RENDERER } = ENV

  function getModuleDirname(mod: unknown) {
    if (isObject(mod)) {
      const { id, path } = mod

      // Electron 6+ creates the inline renderer module with an internal ID,
      // then sets filename to the HTML page without updating Module.path.
      // Only that injected module should derive its base from the page;
      // application modules and explicit custom paths keep their semantics.
      if (
        ELECTRON_RENDERER &&
        (id === "electron/js2c/renderer_init" || id === "node:electron/js2c/renderer_init") &&
        path === dirname(id) &&
        typeof mod.filename === "string"
      ) {
        return dirname(mod.filename)
      }

      if (typeof path === "string") {
        if (isAbsolute(path)) {
          return path
        }

        const { filename } = mod

        // Electron 8 exposes a relative internal path such as "electron/js2c"
        // alongside the document's absolute filename. Resolve its imports
        // beside that document while preserving explicit absolute bases.
        if (typeof filename !== "string" || !isAbsolute(filename)) {
          return path
        }
      }

      if (typeof id === "string" && builtinLookup.has(id)) {
        return ""
      }

      let { filename } = mod

      if (filename === null && typeof id === "string") {
        filename = isFileOrigin(id) ? getFilePathfromURL(id) : id
      }

      if (typeof filename === "string") {
        return dirname(filename)
      }
    }

    return "."
  }

  return getModuleDirname
}

export default shared.inited
  ? shared.module.utilGetModuleDirname
  : (shared.module.utilGetModuleDirname = init())

export type CachedModule = ReturnType<typeof init>
