import Module, { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { parentPort } from "node:worker_threads"
import makeRequire from "esm-sync"

const filename = fileURLToPath(import.meta.url)
const parent = new Module(filename)
parent.filename = filename
parent.paths = createRequire(import.meta.url).resolve.paths("esm-sync") ?? []
const esmRequire = makeRequire(parent)
parentPort.postMessage({ format: "esm", counter: esmRequire("../counter.mjs").counter })
