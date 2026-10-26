"use strict"

const assert = require("node:assert/strict")
const makeRequire = require("esm-sync")
const { checkCommonJS, checkESM } = require("./check-consumer.cjs")

assert.equal(typeof makeRequire, "function")
const checks = { cjs: checkCommonJS, esm: checkESM }
const target = process.argv[2]
if (!Object.hasOwn(checks, target)) throw new Error(`Unknown module format: ${target}`)

Promise.resolve(checks[target](makeRequire(module))).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
