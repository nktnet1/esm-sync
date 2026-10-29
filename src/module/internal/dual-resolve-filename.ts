import type { ModuleRecord } from "../../types/runtime.js"
import Module from "../../module.js"

import esmResolveFilename from "../esm/resolve-filename.js"
import { isPackageExportsError } from "./package-exports.js"
import type { ExportsMode } from "./resolve-exports.js"

function dualResolveFilename(
  request: string,
  parent: ModuleRecord | null | undefined,
  isMain: boolean = false,
  options: { paths?: string[] } | undefined = void 0,
  allowUnknownExtension = false,
  mode: ExportsMode = "import"
) {
  let error: unknown

  try {
    return esmResolveFilename(request, parent, isMain, options, allowUnknownExtension, mode)
  } catch (e) {
    if (isPackageExportsError(e)) throw e
    error = e
  }

  try {
    return Module._resolveFilename(request, parent, isMain, options)
  } catch {}

  throw error
}

export default dualResolveFilename
