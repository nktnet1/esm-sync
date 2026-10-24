import assert from "assert"
import value, { counter, increment } from "./counter.mjs"
import { counter as awaitedCounter, increment as incrementAwaited } from "./await-counter.mjs"
import { value as syntaxValue } from "./async-syntax.mjs"
import { events, read, later, dependency } from "./deferred.mjs"

assert.equal(value, "packed loader")
assert.equal(counter, 41)
assert.equal(increment(), 42)
assert.equal(counter, 42)
assert.equal(awaitedCounter, 41)
assert.equal(incrementAwaited(), 42)
assert.equal(awaitedCounter, 42)
assert.equal(syntaxValue, 42)
assert.deepEqual(events, ["async:start", "async:done"])
assert.equal(read(), 42)
assert.deepEqual(events, ["async:start", "async:done", "body"])
assert.strictEqual(await later(), dependency)

console.log(`Packed CLI preload passed on ${process.version}`)
