"use strict"

const assert = require("node:assert/strict")
const factory = require("esm-sync")
// Published aliases keep working after generated entry points move to dist/.
assert.strictEqual(require("esm-sync/esm.js"), factory)
assert.strictEqual(require("esm-sync/index.js"), factory)

module.exports = async function checkConsumer(esmRequire, format) {
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
  const later = await deferred.later()
  assert.strictEqual(later, deferred.dependency)
  assert.equal(later.value, 42)
  console.log(`Packed ${format} consumer passed on ${process.version}`)
}
