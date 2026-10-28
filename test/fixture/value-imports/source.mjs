import assert from "node:assert/strict"
import source value from "./source-target.source"
import source repeated from "./source-target.source"
import source from from "./source-target.source"
import source query from "./source-target.source?version=1#source"
import text from "./source-target.source?version=1#source" with { type: "text" }
import { value as forwarded } from "./source-forward.mjs"
// `source` is also a valid local default-import name.
import source from "./ordinary.mjs"

assert.equal(source, 17)
assert.strictEqual(value, repeated)
assert.strictEqual(value, from)
assert.strictEqual(value, forwarded)
assert.notStrictEqual(value, query)
assert.match(text, /must not evaluate/)
assert.strictEqual(await import.source("./source-target.source"), value)
assert.strictEqual(await import.source("./source-target.source?version=1#source"), query)
assert.equal(Object.prototype.toString.call(value), "[object ModuleSource]")
assert.deepEqual(Object.getOwnPropertyNames(value), [])
assert.equal(Object.isExtensible(value), true)

const ModuleSource = Object.getPrototypeOf(value).constructor
const abstractPrototype = Object.getPrototypeOf(ModuleSource.prototype)
const AbstractModuleSource = abstractPrototype.constructor
assert.ok(value instanceof ModuleSource)
assert.ok(value instanceof AbstractModuleSource)
assert.throws(() => new ModuleSource(), TypeError)
assert.throws(() => new AbstractModuleSource(), TypeError)
const tag = Object.getOwnPropertyDescriptor(abstractPrototype, Symbol.toStringTag).get
assert.equal(tag.call({}), undefined)
assert.equal(tag.call(Object.create(ModuleSource.prototype)), undefined)
assert.equal(tag.call(new Proxy(value, {})), undefined)
await assert.rejects(import.source("./ordinary.mjs"), SyntaxError)
await assert.rejects(import.source("./ordinary.mjs", { with: { type: "text" } }), SyntaxError)
await assert.rejects(import.source("./absent.mjs"), /Cannot find module/)
await assert.rejects(import.source("./invalid-source.source"), SyntaxError)
// Resource resolution must not grant ordinary imports permission to load
// unknown extensions via the shared filename cache.
await assert.rejects(import("./source-target.source?version=1#source"), { code: "ERR_UNKNOWN_FILE_EXTENSION" })
console.log("source-imports:pass")
