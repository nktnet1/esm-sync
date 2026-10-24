import { existsSync } from "../../safe/fs.js"
import { join } from "../../safe/path.js"

// The loader's legacy CommonJS fallback supports a subset of package exports.
// Carry a captured subpath through conditional and array targets so every
// target wildcard receives the same literal value.
function resolveExports(
  exports: unknown,
  packagePath: string,
  subpath: string,
  captured?: string
): string {
  if (typeof exports === "string") {
    const target = captured === undefined ? exports : exports.replace(/\*/g, () => captured)
    return join(packagePath, target)
  }

  if (Array.isArray(exports)) {
    for (const target of exports as unknown[]) {
      const resolved = resolveExports(target, packagePath, subpath, captured)
      if (resolved !== "" && existsSync(resolved)) return resolved
    }
    return ""
  }

  if (typeof exports !== "object" || exports === null) return ""
  const record = exports as Record<string, unknown>
  for (const condition of ["require", "node", "default"]) {
    if (record[condition]) {
      return resolveExports(record[condition], packagePath, subpath, captured)
    }
  }

  if (record["."] && !subpath) {
    return resolveExports(record["."], packagePath, subpath, captured)
  }

  if (subpath) {
    const normalizedSubpath = `./${subpath}`
    if (record[normalizedSubpath] !== undefined) {
      return resolveExports(record[normalizedSubpath], packagePath, subpath, captured)
    }

    for (const condition of Object.keys(record)) {
      const starIndex = condition.indexOf("*")
      if (
        !condition.startsWith("./") ||
        starIndex === -1 ||
        condition.indexOf("*", starIndex + 1) !== -1
      )
        continue
      const prefix = condition.slice(0, starIndex)
      const suffix = condition.slice(starIndex + 1)
      if (
        normalizedSubpath.length < prefix.length + suffix.length ||
        !normalizedSubpath.startsWith(prefix) ||
        !normalizedSubpath.endsWith(suffix)
      )
        continue
      const matched = normalizedSubpath.slice(
        prefix.length,
        normalizedSubpath.length - suffix.length
      )
      return resolveExports(record[condition], packagePath, subpath, matched)
    }
  }

  return ""
}

export default resolveExports
