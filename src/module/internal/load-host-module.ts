import type { ModuleRecord } from "../../types/runtime.js"
import Module from "../../module.js"
import RealModule from "../../real/module.js"
import { isPackageExportsError } from "./package-exports.js"
import isError from "../../util/is-error.js"
import isExtMJS from "../../path/is-ext-mjs.js"
import isPath from "../../util/is-path.js"

// Hosts such as VS Code supply virtual CommonJS modules through _load,
// without a resolvable filename. Consult that host only after our resolution
// fails, before any module body has run. Do not cache a host's per-parent API.
function loadHostModule(
  request: string,
  parent: ModuleRecord | null | undefined,
  error: unknown,
  isMain = false
): unknown {
  if (
    parent == null ||
    !isError(error) ||
    error.code !== "MODULE_NOT_FOUND" ||
    isPackageExportsError(error) ||
    isExtMJS(parent.filename) ||
    isPath(request) ||
    request.indexOf(":") !== -1 ||
    RealModule._load === Module._load
  ) {
    throw error
  }

  return RealModule._load(request, parent, isMain)
}

export default loadHostModule
