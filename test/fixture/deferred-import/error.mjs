import defer * as deferred from "./throws.mjs"
import assert from "node:assert/strict"

assert.equal(globalThis.deferredModuleFailureCount, undefined)
assert.throws(() => deferred.value, /deferred failure/)
assert.equal(globalThis.deferredModuleFailureCount, 1)
assert.throws(() => deferred.value, /deferred failure/)
assert.equal(globalThis.deferredModuleFailureCount, 1)
console.log("deferred-error:ok")
