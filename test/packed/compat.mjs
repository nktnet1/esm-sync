import assert from "node:assert/strict"
import Module, { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { runCompatibilityCheck } from "./check-compat.cjs"

const check = process.argv[2]
let esmRequire
if (check === "native") {
  // Exercise createRequire directly in an ESM entry, not only from a .cjs helper.
  const moduleRequire = createRequire(import.meta.url)
  assert.strictEqual(
    moduleRequire("./cjs/counter.js"),
    (await import("./cjs/counter.js")).default
  )
} else {
  const { default: makeRequire } = await import("esm-sync")
  const filename = fileURLToPath(import.meta.url)
  const parent = new Module(filename)
  parent.filename = filename
  parent.paths = createRequire(import.meta.url).resolve.paths("esm-sync") ?? []
  esmRequire = makeRequire(parent)
}
await runCompatibilityCheck(check, esmRequire)
