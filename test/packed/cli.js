import assert from "assert"
import value, { counter, increment } from "./counter.mjs"

assert.equal(value, "packed loader")
assert.equal(counter, 41)
assert.equal(increment(), 42)
assert.equal(counter, 42)

console.log(`Packed CLI preload passed on ${process.version}`)
