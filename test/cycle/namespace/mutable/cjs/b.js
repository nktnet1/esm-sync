import assert from "assert"
import { inspect } from "util"
import { getNS } from "./a.js"

const ns = getNS()

// Node versions render pending module namespace proxies differently.
// Check namespace behaviour instead of relying on its inspection string.
assert.strictEqual(Object.getPrototypeOf(ns), null)
assert.strictEqual(typeof inspect(ns), "string")
assert.strictEqual(Reflect.isExtensible(ns), true)
assert.strictEqual(Reflect.defineProperty(ns, "ADDED", { value: 1 }), false)
assert.strictEqual(Reflect.has(ns, "ADDED"), false)
assert.strictEqual(typeof inspect(ns), "string")
assert.strictEqual(Reflect.preventExtensions(ns), false)
