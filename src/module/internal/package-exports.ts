import ENV from "../../constant/env.js"
import errors from "../../errors.js"
import { basename, dirname, resolve, sep } from "../../safe/path.js"
import readPackage from "./read-package.js"
import resolveExports, { type ExportsMode, type PackageExportErrorCode } from "./resolve-exports.js"
import realProcess from "../../real/process.js"
import shared from "../../shared.js"
import get from "../../util/get.js"
import realpath from "../../fs/realpath.js"
import statFast from "../../fs/stat-fast.js"

const packagePattern = /^((?:@[^/\\%]+\/)?[^./\\%][^/\\%]*)(\/.*)?$/

function packageExportsError<T>(error: T): T {
  if (typeof error === "object" && error !== null)
    shared.memoize.modulePackageExportsErrors.add(error)
  return error
}

export function isPackageExportsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (shared.memoize.modulePackageExportsErrors.has(error) ||
      [
        "ERR_PACKAGE_PATH_NOT_EXPORTED",
        "ERR_INVALID_PACKAGE_TARGET",
        "ERR_INVALID_PACKAGE_CONFIG",
        "ERR_INVALID_MODULE_SPECIFIER"
      ].includes(String(get(error, "code"))))
  )
}

function parts(request: string) {
  const match = packagePattern.exec(request)
  return match ? { name: match[1]!, subpath: "." + (match[2] || "") } : null
}

function finish(
  json: Record<string, unknown>,
  dir: string,
  subpath: string,
  mode: ExportsMode,
  isMain: boolean
) {
  try {
    const jsonPath = dir + sep + "package.json"
    const conditions = new Set(["node", mode, ...ENV.FLAGS.conditions])
    if (ENV.FLAGS.addons) conditions.add("node-addons")
    if (get(realProcess.features, "require_module") === true) conditions.add("module-sync")
    const createError = (code: PackageExportErrorCode, key: string, value?: unknown): Error => {
      switch (code) {
        case "ERR_INVALID_PACKAGE_TARGET":
          return new errors.ERR_INVALID_PACKAGE_TARGET(jsonPath, key, value)
        case "ERR_INVALID_PACKAGE_CONFIG":
          return new errors.ERR_INVALID_PACKAGE_CONFIG(jsonPath, key)
        case "ERR_INVALID_MODULE_SPECIFIER":
          return new errors.ERR_INVALID_MODULE_SPECIFIER(key, value, jsonPath)
        case "ERR_PACKAGE_PATH_NOT_EXPORTED":
          return new errors.ERR_PACKAGE_PATH_NOT_EXPORTED(jsonPath, key)
      }
    }
    const target = resolveExports(json.exports, dir, subpath, mode, { conditions, createError })
    const stat = statFast(target)
    if (stat !== 0) {
      const error =
        mode === "import"
          ? stat === 1
            ? new errors.ERR_UNSUPPORTED_DIR_IMPORT(target)
            : new errors.ERR_MODULE_NOT_FOUND(target)
          : errors.MODULE_NOT_FOUND(target)
      error.path = dir + sep + "package.json"
      throw error
    }
    const preserve =
      ENV.TINK ||
      ENV.YARN_PNP ||
      (isMain ? ENV.FLAGS.preserveSymlinksMain : ENV.FLAGS.preserveSymlinks)
    const filename = preserve ? target : realpath(target)
    if (filename === "")
      throw mode === "import"
        ? new errors.ERR_MODULE_NOT_FOUND(target)
        : errors.MODULE_NOT_FOUND(target)
    return filename
  } catch (error) {
    throw packageExportsError(error)
  }
}

export function resolvePackageExports(
  request: string,
  lookupPath: string,
  mode: ExportsMode,
  isMain = false
) {
  const parsed = parts(request)
  if (parsed === null) return undefined
  const dir = resolve(lookupPath, parsed.name)
  const json = readPackage(dir)
  return json?.exports == null ? undefined : finish(json, dir, parsed.subpath, mode, isMain)
}

function selfPackage(request: string, parentPath: string) {
  const parsed = parts(request)
  if (parsed === null || parentPath === "") return null
  let dir = parentPath
  while (basename(dir) !== "node_modules") {
    const json = readPackage(dir)
    if (json !== null) {
      return json.name === parsed.name && json.exports != null
        ? { json, dir, subpath: parsed.subpath }
        : null
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function resolveSelfExports(
  request: string,
  parentPath: string,
  mode: ExportsMode,
  isMain = false
) {
  const pkg = selfPackage(request, parentPath)
  return pkg === null ? undefined : finish(pkg.json, pkg.dir, pkg.subpath, mode, isMain)
}

// .mjs keeps the legacy relative-file restrictions, but an export map may
// explicitly select ESM .js entry points, including those in nested folders.
export function isPackageExportsRequest(request: string, parentPath: string, paths: string[]) {
  const parsed = parts(request)
  if (parsed === null) return false
  if (selfPackage(request, parentPath) !== null) return true
  for (const lookupPath of paths) {
    const dir = resolve(lookupPath, parsed.name)
    if (statFast(dir) === 1) return readPackage(dir)?.exports != null
  }
  return false
}
