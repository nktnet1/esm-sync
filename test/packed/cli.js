import assert from "assert"
import value, { counter, increment } from "./counter.mjs"
import { counter as awaitedCounter, increment as incrementAwaited } from "./await-counter.mjs"
import { value as syntaxValue } from "./async-syntax.mjs"

assert.equal(value, "packed loader")
assert.equal(counter, 41)
assert.equal(increment(), 42)
assert.equal(counter, 42)
assert.equal(awaitedCounter, 41)
assert.equal(incrementAwaited(), 42)
assert.equal(awaitedCounter, 42)
assert.equal(syntaxValue, 42)

console.log(`Packed CLI preload passed on ${process.version}`)
