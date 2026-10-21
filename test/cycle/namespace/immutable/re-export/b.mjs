import assert from "assert"
import { inspect } from "util"
import { getNS } from "./a.mjs"

const ns = getNS()

// Node versions format nested proxies differently; test behaviour rather than output.
assert.strictEqual(Object.getPrototypeOf(ns), null)
assert.strictEqual(typeof inspect(ns), "string")
assert.strictEqual(Reflect.isExtensible(ns), true)
assert.strictEqual(Reflect.defineProperty(ns, "ADDED", { value: 1 }), false)
assert.strictEqual(Reflect.has(ns, "ADDED"), false)
assert.strictEqual(typeof inspect(ns), "string")
assert.strictEqual(Reflect.preventExtensions(ns), false)
