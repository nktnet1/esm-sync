import type { ModuleRecord } from "../../types/runtime.js"
import Module from "../../module.js"
import errors from "../../errors.js"
import { basename, dirname, sep } from "../../safe/path.js"
import getURLFromFilePath from "../../util/get-url-from-file-path.js"
import readPackage from "./read-package.js"
import resolveExports, { type ExportsMode } from "./resolve-exports.js"
import {
  packageConditions,
  packageMapError,
  finalizePackageURL,
  resolveURLReference
} from "./package-map.js"
import shared from "../../shared.js"
import realProcess from "../../real/process.js"

function packageScope(fromPath: string) {
  let dir = fromPath
  while (dir !== "" && basename(dir) !== "node_modules") {
    const json = readPackage(dir)
    if (json !== null) return { dir, json }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function hasPackageImports(fromPath: string) {
  return packageScope(fromPath)?.json.imports != null
}

export default function resolvePackageImports(
  request: string,
  fromPath: string,
  parent: ModuleRecord | null | undefined,
  mode: ExportsMode,
  resolveExternal: (request: string, parent: ModuleRecord) => string,
  resolveOnly = false
): string {
  try {
    // Node 22 retains the older rejection of the '#/' prefix. Current Node
    // 24/26 allow that spelling and report unmapped names through the map.
    if (
      request === "#" ||
      request.endsWith("/") ||
      (Number(realProcess.versions.node.split(".")[0]) < 24 && request.startsWith("#/"))
    )
      throw new errors.ERR_INVALID_MODULE_SPECIFIER(
        request,
        "is not a valid internal imports specifier",
        fromPath
      )
    const scope = packageScope(fromPath)
    const filename = scope === null ? fromPath : scope.dir + sep + "package.json"
    if (scope === null) throw new errors.ERR_PACKAGE_IMPORT_NOT_DEFINED(request, filename)
    const baseURL = getURLFromFilePath(scope.dir + sep)
    const packageParent = new Module(filename, parent)
    packageParent.filename = filename
    packageParent.paths = Module._nodeModulePaths(scope.dir)
    const resolved = resolveExports(scope.json.imports, scope.dir, request, mode, {
      internal: true,
      conditions: packageConditions(mode),
      createError: (code, key, value) => packageMapError(filename, code, key, value),
      resolveTarget: (target) =>
        target.startsWith("./")
          ? resolveURLReference(target, baseURL)
          : resolveExternal(target, packageParent)
    })
    return finalizePackageURL(resolved, mode, false, resolveOnly)
  } catch (error) {
    // A package map's rejection is terminal, including errors from selected
    // dependencies. Legacy CommonJS fallbacks must not bypass that mapping.
    if (typeof error === "object" && error !== null)
      shared.memoize.modulePackageExportsErrors.add(error)
    throw error
  }
}
