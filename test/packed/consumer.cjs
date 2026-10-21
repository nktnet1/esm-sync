"use strict"

const assert = require("node:assert/strict")
const makeRequire = require("esm-sync")

assert.equal(typeof makeRequire, "function")

const esmRequire = makeRequire(module)
const namespace = esmRequire("./counter.mjs")

assert.equal(namespace.counter, 41)
assert.equal(namespace.increment(), 42)
assert.equal(namespace.counter, 42)
assert.equal(namespace.default, "packed loader")

console.log(`Packed CommonJS consumer passed on ${process.version}`)
