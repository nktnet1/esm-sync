import ENTRY from "../constant/entry.js"

import Loader from "../loader.js"
import Package from "../package.js"

import { dirname } from "../safe/path.js"
import errors from "../errors.js"
import dualResolveFilename from "../module/internal/dual-resolve-filename.js"
import esmParseLoad from "../module/esm/parse-load.js"
import makeRequireFunction from "../module/internal/make-require-function.js"
import loadHostModule from "../module/internal/load-host-module.js"
import shared from "../shared.js"
import "../util/validate-string.js"

const { TYPE_CJS } = ENTRY

const { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } = errors

function hook(parent: import("../types/runtime.js").ModuleRecord) {
  function requirer(request: unknown) {
    if (typeof request !== "string") throw new ERR_INVALID_ARG_TYPE("request", "string", request)

    if (request === "") {
      throw new ERR_INVALID_ARG_VALUE("request", request, "must be a non-empty string")
    }

    let filename: string
    try {
      filename = dualResolveFilename(request, parent, false, void 0, false, "require")
    } catch (error) {
      return loadHostModule(request, parent, error)
    }
    const defaultPkg = Loader.state.package.default
    const dirPath = dirname(filename)

    if (Package.get(dirPath) === defaultPkg) {
      // Clone the default package to avoid the parsing phase fallback path
      // of module/internal/compile.
      Package.set(dirPath, defaultPkg.clone())
    }

    const entry = esmParseLoad(request, parent)
    const exported = entry.module.exports

    if (entry.type !== TYPE_CJS) {
      shared.bridged.set(exported, entry)
    }

    return exported
  }

  function resolver(request: string, options?: { paths?: string[] }) {
    return dualResolveFilename(request, parent, false, options, false, "require")
  }

  const req = makeRequireFunction(parent, requirer, resolver)

  req.main = Loader.state.module.mainModule

  return req
}

export default hook
