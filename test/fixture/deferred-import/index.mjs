import defer * as deferred from "./child.mjs"
import assert from "node:assert/strict"

assert.equal(globalThis.deferredModuleEvaluationCount, undefined)
assert.equal(Object.getPrototypeOf(deferred), null)
assert.equal(globalThis.deferredModuleEvaluationCount, undefined)
assert.equal(deferred.value, 42)
assert.equal(globalThis.deferredModuleEvaluationCount, 1)
assert.equal(deferred.then, undefined)
assert.equal(globalThis.deferredModuleEvaluationCount, 1)
assert.equal(Reflect.set(deferred, "value", 99), false)
assert.equal(deferred.value, 42)
console.log("deferred-import:ok")
