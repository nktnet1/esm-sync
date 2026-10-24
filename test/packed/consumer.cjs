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

const awaited = esmRequire("./await-counter.mjs")
assert.equal(awaited.counter, 41)
assert.strictEqual(awaited, esmRequire("./await-counter.mjs"))
assert.equal(awaited.increment(), 42)
assert.equal(awaited.counter, 42)
assert.equal(typeof awaited.later().then, "function")

const syntax = esmRequire("./async-syntax.mjs")
assert.equal(syntax.value, 42)
assert.strictEqual(syntax, esmRequire("./async-syntax.mjs"))

const deferred = esmRequire("./deferred.mjs")
assert.deepEqual(deferred.events, ["async:start", "async:done"])
assert.equal(deferred.read(), 42)
assert.deepEqual(deferred.events, ["async:start", "async:done", "body"])
deferred.later().then((namespace) => {
  assert.strictEqual(namespace, deferred.dependency)
  assert.equal(namespace.value, 42)
  console.log(`Packed CommonJS consumer passed on ${process.version}`)
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
