import assert from "assert"
import { inspect } from "util"
import { getNS } from "./a.js"

const ns = getNS()

// The pending export exists, but Node versions display its value differently.
assert.strictEqual(Object.getPrototypeOf(ns), null)
assert.strictEqual(Reflect.has(ns, "e"), true)
assert.strictEqual(typeof inspect(ns), "string")
assert.strictEqual(Reflect.isExtensible(ns), true)
assert.strictEqual(Reflect.defineProperty(ns, "ADDED", { value: 1 }), true)
assert.strictEqual(Reflect.has(ns, "e"), true)
assert.strictEqual(typeof inspect(ns), "string")
assert.strictEqual(Reflect.preventExtensions(ns), true)
