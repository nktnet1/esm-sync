import type { ModuleRecord } from "../../types/runtime.js"
import Module from "../../module.js"

import esmResolveFilename from "../esm/resolve-filename.js"

function dualResolveFilename(
  request: string,
  parent: ModuleRecord | null | undefined,
  isMain: boolean = false,
  options: { paths?: string[] } | undefined = void 0
) {
  let error: unknown

  try {
    return esmResolveFilename(request, parent, isMain, options)
  } catch (e) {
    error = e
  }

  try {
    return Module._resolveFilename(request, parent, isMain, options)
  } catch {}

  throw error
}

export default dualResolveFilename
