import assert from "node:assert/strict"
import Module, { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import makeRequire from "esm-sync"
import { checkCommonJS, checkESM } from "./check-consumer.cjs"

assert.equal(typeof makeRequire, "function")
const filename = fileURLToPath(import.meta.url)
const parent = new Module(filename)
parent.filename = filename
parent.paths = createRequire(import.meta.url).resolve.paths("esm-sync") ?? []

const esmRequire = makeRequire(parent)
const checks = { cjs: checkCommonJS, esm: checkESM }
const target = process.argv[2]
if (!Object.hasOwn(checks, target)) throw new Error(`Unknown module format: ${target}`)

if (target === "esm") {
  // Native ESM startup runs in a microtask, where synchronous loop polling is
  // intentionally guarded. Prepare async modules through the loader's import().
  await esmRequire("./load-async.mjs").prepare()
}
await checks[target](esmRequire)
