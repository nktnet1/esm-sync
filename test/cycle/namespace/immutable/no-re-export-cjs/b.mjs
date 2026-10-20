import assert from "assert"
import { inspect } from "util"
import { getNS } from "./a.mjs"

const ns = getNS()

// Match the namespace content rather than Node-specific Proxy(...) wrappers.
const uninitializedExport = /\[Module\] \{ e: (?:\{\})?<uninitialized> \}/

assert.strictEqual(Object.getPrototypeOf(ns), null)
assert.ok(Reflect.has(ns, "e"))
assert.ok(uninitializedExport.test(inspect(ns)))
assert.strictEqual(Reflect.isExtensible(ns), false)
assert.strictEqual(Reflect.defineProperty(ns, "ADDED", { value: 1 }), false)
assert.ok(uninitializedExport.test(inspect(ns)))
assert.strictEqual(Reflect.preventExtensions(ns), true)
