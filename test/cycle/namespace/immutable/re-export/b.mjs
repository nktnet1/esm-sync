import assert from "assert"
import { inspect } from "util"
import { getNS } from "./a.mjs"

const ns = getNS()

// Match the empty namespace instead of Node-specific Proxy(...) wrappers.
const emptyNamespace = /\[Module\] \{\}/

assert.strictEqual(Object.getPrototypeOf(ns), null)
assert.ok(emptyNamespace.test(inspect(ns)))
assert.strictEqual(Reflect.isExtensible(ns), true)
assert.strictEqual(Reflect.defineProperty(ns, "ADDED", { value: 1 }), false)
assert.ok(emptyNamespace.test(inspect(ns)))
assert.strictEqual(Reflect.preventExtensions(ns), false)
