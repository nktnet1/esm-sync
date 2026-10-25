"use strict"

const assert = require("node:assert/strict")
const makeRequire = require("esm-sync")
const checkConsumer = require("./check-consumer.cjs")

assert.equal(typeof makeRequire, "function")
checkConsumer(makeRequire(module), "CommonJS").catch((error) => {
  console.error(error)
  process.exitCode = 1
})
