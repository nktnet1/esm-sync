// Package target matching follows Node's packageExportsResolve algorithm.
// Copyright Node.js contributors. Released under the MIT license.
// https://github.com/nodejs/node/blob/main/lib/internal/modules/esm/resolve.js
import { join, sep } from "../../safe/path.js"
import get from "../../util/get.js"
import has from "../../util/has.js"

export type ExportsMode = "import" | "require"

export type PackageExportErrorCode =
  | "ERR_PACKAGE_PATH_NOT_EXPORTED"
  | "ERR_INVALID_PACKAGE_TARGET"
  | "ERR_INVALID_PACKAGE_CONFIG"
  | "ERR_INVALID_MODULE_SPECIFIER"
  | "ERR_PACKAGE_IMPORT_NOT_DEFINED"
interface ResolverOptions {
  conditions?: ReadonlySet<string>
  createError?: (code: PackageExportErrorCode, key: string, value?: unknown) => Error
  internal?: boolean
  resolveTarget?: (target: string) => string
}

function resolveExports(
  exports: unknown,
  packagePath: string,
  subpath: string,
  mode: ExportsMode = "require",
  options: ResolverOptions = {}
): string {
  const jsonPath = packagePath + sep + "package.json"
  const internal = options.internal === true
  const request = internal
    ? subpath
    : subpath === "" || subpath === "."
      ? "."
      : subpath.startsWith("./")
        ? subpath
        : "./" + subpath
  const conditions = options.conditions ?? new Set(["node", mode])
  const fail = (code: PackageExportErrorCode, key: string, value?: unknown) => {
    if (options.createError) return options.createError(code, key, value)
    const Constructor = code === "ERR_INVALID_MODULE_SPECIFIER" ? TypeError : Error
    return Object.assign(new Constructor(code + ": " + key + " in " + jsonPath), { code })
  }

  const invalidTarget = (target: unknown, key: string) =>
    fail("ERR_INVALID_PACKAGE_TARGET", key, target)

  function checkSegments(value: string, key: string, target: boolean) {
    const pathname = value.split(/[?#]/, 1)[0]!
    for (const segment of pathname.split(/[\\/]/)) {
      const decoded = decodeURIComponent(segment).toLowerCase()
      if (decoded === "." || decoded === ".." || decoded === "node_modules") {
        throw target
          ? invalidTarget(value, key)
          : fail("ERR_INVALID_MODULE_SPECIFIER", request, "contains an invalid segment")
      }
    }
  }

  function target(
    value: unknown,
    key: string,
    captured: string = "",
    pattern = false,
    folder = false
  ): string | null | undefined {
    if (typeof value === "string") {
      if (!value.startsWith("./")) {
        // Imports may select a dependency, but never
        // an absolute path, parent traversal, or an absolute URL.
        if (
          !internal ||
          value.startsWith("../") ||
          value.startsWith("/") ||
          /^[a-zA-Z][\w+.-]*:/.test(value)
        )
          throw invalidTarget(value, key)
        const expanded = pattern ? value.replace(/\*/g, () => captured) : value + captured
        let separator = expanded.indexOf("/")
        const scoped = expanded[0] === "@"
        if (scoped && separator !== -1) separator = expanded.indexOf("/", separator + 1)
        const packageName = separator === -1 ? expanded : expanded.slice(0, separator)
        if ((scoped && expanded.indexOf("/") === -1) || /^\.|%|\\/.test(packageName))
          throw fail("ERR_INVALID_MODULE_SPECIFIER", expanded, "is not a valid package name")
        return options.resolveTarget!(expanded)
      }
      if (folder && !value.endsWith("/")) throw invalidTarget(value, key)
      checkSegments(value.slice(2), key, true)
      if (captured !== "") checkSegments(captured, key, false)
      const expanded = pattern ? value.replace(/\*/g, () => captured) : value + captured
      if (/%2f|%5c/i.test(expanded.split(/[?#]/, 1)[0]!)) {
        throw fail("ERR_INVALID_MODULE_SPECIFIER", request, "contains encoded path separators")
      }
      if (options.resolveTarget) return options.resolveTarget(expanded)
      // Decode after removing URL suffixes, retaining encoded filename characters.
      return join(
        packagePath,
        decodeURIComponent(expanded.split(/[?#]/, 1)[0]!.slice(2)).replace(/\\/g, "/")
      )
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return null
      let lastException: unknown
      for (const item of value as unknown[]) {
        let result: string | null | undefined
        try {
          result = target(item, key, captured, pattern, folder)
        } catch (error) {
          if (get(error, "code") !== "ERR_INVALID_PACKAGE_TARGET") throw error
          lastException = error
          continue
        }
        if (result === undefined) continue
        if (result === null) {
          lastException = null
          continue
        }
        return result
      }
      if (lastException != null) throw lastException
      return lastException
    }
    if (value === null) return null
    if (typeof value === "object") {
      const keys = Object.keys(value)
      for (const key of keys) {
        const number = Number(key)
        if (String(number) === key && number >= 0 && number < 0xffffffff) {
          throw fail(
            "ERR_INVALID_PACKAGE_CONFIG",
            '"' + (internal ? "imports" : "exports") + '" cannot contain numeric property keys'
          )
        }
      }
      for (const condition of keys) {
        if (condition === "default" || conditions.has(condition)) {
          const result = target(get(value, condition), key, captured, pattern, folder)
          if (result !== undefined) return result
        }
      }
      return undefined
    }
    throw invalidTarget(value, key)
  }

  let map: Record<string, unknown> = {}
  if (internal) {
    if (exports !== null && typeof exports === "object" && !Array.isArray(exports))
      map = exports as Record<string, unknown>
  } else if (typeof exports === "string" || Array.isArray(exports)) map = { ".": exports }
  else if (typeof exports === "object" && exports !== null) {
    const keys = Object.keys(exports)
    const conditional = keys.length !== 0 && !keys[0]!.startsWith(".")
    if (keys.some((key) => !key.startsWith(".") !== conditional)) {
      throw fail("ERR_INVALID_PACKAGE_CONFIG", '"exports" cannot mix subpath and condition keys')
    }
    map = conditional ? { ".": exports } : (exports as Record<string, unknown>)
  }

  let resolved: string | null | undefined
  if (has(map, request) && !request.includes("*") && !request.endsWith("/")) {
    resolved = target(map[request], request)
  } else {
    let best = ""
    let bestBase = -1
    let captured = ""
    let pattern = false
    for (const key of Object.keys(map)) {
      const star = key.indexOf("*")
      const isPattern = star !== -1 && key.lastIndexOf("*") === star
      const isFolder = !internal && star === -1 && key.endsWith("/")
      if (!key.startsWith(internal ? "#" : "./") || (!isPattern && !isFolder)) continue
      const prefix = isPattern ? key.slice(0, star) : key
      const suffix = isPattern ? key.slice(star + 1) : ""
      if (
        !request.startsWith(prefix) ||
        !request.endsWith(suffix) ||
        request.length < (isPattern ? key.length : key.length + 1)
      )
        continue
      const base = isPattern ? star + 1 : key.length
      if (base < bestBase || (base === bestBase && key.length <= best.length)) continue
      best = key
      bestBase = base
      captured = request.slice(prefix.length, request.length - suffix.length)
      pattern = isPattern
    }
    if (best !== "") resolved = target(map[best], best, captured, pattern, !pattern)
  }
  if (resolved == null)
    throw fail(
      internal ? "ERR_PACKAGE_IMPORT_NOT_DEFINED" : "ERR_PACKAGE_PATH_NOT_EXPORTED",
      request
    )
  return resolved
}

export default resolveExports
