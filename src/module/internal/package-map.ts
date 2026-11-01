import ENV from "../../constant/env.js"
import errors from "../../errors.js"
import realpath from "../../fs/realpath.js"
import statFast from "../../fs/stat-fast.js"
import realProcess from "../../real/process.js"
import safeURL, { URL } from "../../safe/url.js"
import get from "../../util/get.js"
import getFilePathFromURL from "../../util/get-file-path-from-url.js"
import getURLFromFilePath from "../../util/get-url-from-file-path.js"
import type { ExportsMode, PackageExportErrorCode } from "./resolve-exports.js"
import isAbsolute from "../../path/is-absolute.js"
import parseURL from "../../util/parse-url.js"

export function resolveURLReference(request: string, base?: string) {
  return typeof URL === "function"
    ? new URL(request, base).href
    : base === undefined
      ? parseURL(request).href
      : safeURL.resolve(base, request)
}

export function packageConditions(mode: ExportsMode) {
  const conditions = new Set(["node", mode, ...ENV.FLAGS.conditions])
  if (ENV.FLAGS.addons) conditions.add("node-addons")
  if (get(realProcess.features, "require_module") === true) conditions.add("module-sync")
  return conditions
}

export function packageMapError(
  filename: string,
  code: PackageExportErrorCode,
  key: string,
  value?: unknown
): Error {
  switch (code) {
    case "ERR_INVALID_PACKAGE_TARGET":
      return new errors.ERR_INVALID_PACKAGE_TARGET(filename, key, value)
    case "ERR_INVALID_PACKAGE_CONFIG":
      return new errors.ERR_INVALID_PACKAGE_CONFIG(filename, key)
    case "ERR_INVALID_MODULE_SPECIFIER":
      return new errors.ERR_INVALID_MODULE_SPECIFIER(key, value, filename)
    case "ERR_PACKAGE_PATH_NOT_EXPORTED":
      return new errors.ERR_PACKAGE_PATH_NOT_EXPORTED(filename, key)
    case "ERR_PACKAGE_IMPORT_NOT_DEFINED":
      return new errors.ERR_PACKAGE_IMPORT_NOT_DEFINED(key, filename)
  }
}

// Resolution-only calls may name absent files and directories. Loading calls
// validate the exact target without extension or index-file probing.
export function finalizePackageURL(
  url: string,
  mode: ExportsMode,
  isMain = false,
  resolveOnly = false
): string {
  const parsed = parseURL(isAbsolute(url) ? getURLFromFilePath(url) : url)
  if (parsed.protocol !== "file:") return parsed.href
  if (/%2f|%5c/i.test(parsed.pathname))
    throw new errors.ERR_INVALID_MODULE_SPECIFIER(url, "contains encoded path separators", url)
  const target =
    typeof safeURL.fileURLToPath === "function"
      ? safeURL.fileURLToPath(parsed.href)
      : getFilePathFromURL(parsed.href)
  const stat = statFast(target)
  if (!resolveOnly && stat !== 0) {
    throw mode === "require"
      ? errors.MODULE_NOT_FOUND(target)
      : stat === 1
        ? new errors.ERR_UNSUPPORTED_DIR_IMPORT(target)
        : new errors.ERR_MODULE_NOT_FOUND(target)
  }
  const preserve =
    ENV.TINK ||
    ENV.YARN_PNP ||
    (isMain ? ENV.FLAGS.preserveSymlinksMain : ENV.FLAGS.preserveSymlinks)
  const filename = !preserve && stat === 0 ? realpath(target) || target : target
  if (mode === "require") return filename
  return stat === 0 && !preserve
    ? getURLFromFilePath(filename) + parsed.search + parsed.hash
    : parsed.href
}
