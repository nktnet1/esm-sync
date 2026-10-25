import assert from "node:assert/strict"
import Module, { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import makeRequire from "esm-sync"
import checkConsumer from "./check-consumer.cjs"

assert.equal(typeof makeRequire, "function")
const filename = fileURLToPath(import.meta.url)
const parent = new Module(filename)
parent.filename = filename
parent.paths = createRequire(import.meta.url).resolve.paths("esm-sync") ?? []

const esmRequire = makeRequire(parent)
// Native ESM startup runs in a microtask, where synchronous loop polling is
// intentionally guarded. Prepare async modules through the loader's import().
await esmRequire("./load-async.mjs").prepare()
await checkConsumer(esmRequire, "ESM")
