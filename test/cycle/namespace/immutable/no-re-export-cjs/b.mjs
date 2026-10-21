import assert from "assert"
import { inspect } from "util"
import { getNS } from "./a.mjs"

const ns = getNS()

// Node versions format pending bindings and nested proxies differently.
// Inspection must succeed, without making assertions about its presentation.
assert.strictEqual(Object.getPrototypeOf(ns), null)
assert.ok(Reflect.has(ns, "e"))
assert.strictEqual(typeof inspect(ns), "string")
assert.strictEqual(Reflect.isExtensible(ns), false)
assert.strictEqual(Reflect.defineProperty(ns, "ADDED", { value: 1 }), false)
assert.strictEqual(Reflect.has(ns, "ADDED"), false)
assert.strictEqual(typeof inspect(ns), "string")
assert.strictEqual(Reflect.preventExtensions(ns), true)
