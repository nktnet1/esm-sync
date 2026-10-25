import type { CacheMeta } from "../types/runtime.js"

// Cache files are untrusted JSON. Invalid metadata must trigger recompilation.
export default function parseCacheMeta(value: unknown): CacheMeta | null {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 8 && value.length !== 10))
    return null
  const fields: unknown[] = value
  if (!Number.isInteger(fields[0]) || !Number.isInteger(fields[1])) return null
  if (fields.length > 2) {
    for (const index of [2, 3, 4]) if (typeof fields[index] !== "number") return null
    for (const index of [5, 6]) {
      const position = fields[index]
      if (
        position !== null &&
        (!Array.isArray(position) ||
          position.length !== 2 ||
          typeof position[0] !== "number" ||
          typeof position[1] !== "number")
      )
        return null
    }
    if (fields[7] !== null && typeof fields[7] !== "string") return null
  }
  if (fields.length === 10 && (typeof fields[8] !== "number" || typeof fields[9] !== "number"))
    return null
  return fields as CacheMeta
}
