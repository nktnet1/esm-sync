import type { ModuleRecord } from "./types/runtime.js"
import Entry from "./entry.js"
import Module from "./module.js"
import compile from "./module/internal/compile.js"

// Jest owns (and may freeze) the supplied module. Compile into a loader record
// without modifying that host object or asking Jest to execute the file twice.
export default function runJest(
  parent: ModuleRecord,
  source: string,
  filename: string,
  jest: unknown
): unknown {
  const mod = new Module(filename, parent)
  mod.filename = filename
  const entry = Entry.get(mod)
  entry.jest = jest
  entry._ranthruCompile = true
  compile(runJest, entry, source, filename)
  return mod.exports
}
