import type Entry from "../../entry.js"
import type { ModuleRecord } from "../../types/runtime.js"
import Module from "../../module.js"
import realProcess from "../../real/process.js"
import builtinLookup from "../../builtin-lookup.js"
import errors from "../../errors.js"
import { dirname, resolve } from "../../safe/path.js"
import get from "../../util/get.js"
import getFilePathFromURL from "../../util/get-file-path-from-url.js"
import getURLFromFilePath from "../../util/get-url-from-file-path.js"
import isFileOrigin from "../../util/is-file-origin.js"
import isPath from "../../util/is-path.js"
import toExternalFunction from "../../util/to-external-function.js"
import toExternalError from "../../util/to-external-error.js"
import resolveFilename from "../esm/resolve-filename.js"
import resolveLookupPaths from "./resolve-lookup-paths.js"
import resolvePackageImports from "./package-imports.js"
import { resolvePackageExportsURL } from "./package-exports.js"
import { finalizePackageURL, resolveURLReference } from "./package-map.js"

// Keep String callable: coercion must use the string ToPrimitive hint even
// after minification, and errors from user-defined coercion must propagate.
const ImportString = String

function resolveURL(
  request: string,
  parent: ModuleRecord,
  baseURL: string,
  packageTarget = false
): string {
  if (request.startsWith("node:")) return resolveURLReference(request)
  if (builtinLookup.has(request)) return "node:" + request
  if (
    request.startsWith("./") ||
    request.startsWith("../") ||
    request.startsWith("/") ||
    /^[a-zA-Z][\w+.-]*:/.test(request)
  ) {
    return finalizePackageURL(resolveURLReference(request, baseURL), "import", false, true)
  }
  const fromPath = dirname(parent.filename!)
  if (request.startsWith("#") && !packageTarget) {
    return resolvePackageImports(
      request,
      fromPath,
      parent,
      "import",
      (target, packageParent) =>
        resolveURL(target, packageParent, getURLFromFilePath(packageParent.filename!), true),
      true
    )
  }
  const paths = resolveLookupPaths(request, parent, true) ?? []
  const exported = resolvePackageExportsURL(request, fromPath, paths, "import")
  if (exported !== undefined) return exported
  try {
    const filename = resolveFilename(request, parent, false, void 0, true, "import", packageTarget)
    return builtinLookup.has(filename) ? "node:" + filename : getURLFromFilePath(filename)
  } catch (error) {
    if (get(error, "code") === "MODULE_NOT_FOUND") throw new errors.ERR_MODULE_NOT_FOUND(request)
    throw error
  }
}

export default function createImportMeta(entry: Entry) {
  const { id, module: mod } = entry
  const url = isFileOrigin(id) ? id : isPath(id) ? getURLFromFilePath(id) : null
  const filename = url === null ? undefined : getFilePathFromURL(url)
  const baseURL = url ?? getURLFromFilePath(resolve(entry.dirname || ".", "[eval]"))
  const parent = new Module(filename ?? getFilePathFromURL(baseURL))
  parent.filename = filename ?? getFilePathFromURL(baseURL)
  parent.paths = Module._nodeModulePaths(dirname(parent.filename))
  const resolveSpecifier = toExternalFunction((specifier: unknown) => {
    try {
      if (typeof specifier === "symbol")
        throw new TypeError("Cannot convert a Symbol value to a string")
      return resolveURL(ImportString(specifier), parent, baseURL)
    } catch (error) {
      toExternalError(error)
      throw error
    }
  })
  Object.defineProperty(resolveSpecifier, "name", { configurable: true, value: "resolve" })
  // Node 26 exposes its optional parent parameter in the function's arity.
  Object.defineProperty(resolveSpecifier, "length", {
    configurable: true,
    value: Number(realProcess.versions.node.split(".")[0]) >= 26 ? 2 : 1
  })
  return {
    __proto__: null,
    ...(filename === undefined ? {} : { dirname: dirname(filename), filename }),
    main: mod.id === ".",
    resolve: resolveSpecifier,
    url
  }
}
