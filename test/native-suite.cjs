"use strict"

// Run native-Node test suites as CommonJS so Node doesn't need to infer whether
// this entry point is ESM after the package's require hooks are installed.
const { beforeEach } = globalThis.__esmSyncNativeTest
const resetState = require("./reset-state.js").default

const suites = new Set([
  "cache-tests.js",
  "dynamic-import-tests.mjs",
  "export-tests.mjs",
  "file-extension-tests.js",
  "import-tests.js",
  "misc-tests.js",
  "require-hook-tests.js",
  "scenario-tests.mjs",
  "setter-tests.js",
  "top-level-await-tests.js",
  "url-tests.mjs",
  "wasm-tests.js"
])

const suite = process.argv[2]

if (!suites.has(suite)) {
  throw new Error(`Unknown native test suite: ${suite}`)
}

beforeEach(resetState)
import(`./${suite}`).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
