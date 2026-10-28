import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import bytes from "./resource.mjs" with { type: "bytes" }
import repeated from "./resource.mjs" with { type: "bytes" }
import text from "./resource.mjs" with { type: "text" }
import different from "./resource.mjs?version=1#bytes" with { type: "bytes" }

assert.equal(globalThis.__esmSyncValueResourceRuns, undefined)
const raw = readFileSync(new URL("./resource.mjs", import.meta.url))
assert.ok(bytes instanceof Uint8Array)
assert.ok(bytes.buffer instanceof ArrayBuffer)
assert.equal(bytes.byteOffset, 0)
assert.equal(bytes.buffer.byteLength, raw.length)
assert.deepEqual(Buffer.from(bytes), raw)
assert.equal(text, raw.toString("utf8"))
assert.strictEqual(bytes, repeated)
assert.notStrictEqual(bytes, different)
assert.strictEqual((await import("./resource.mjs", { with: { type: "bytes" } })).default, bytes)
assert.strictEqual((await import("./resource.mjs?version=1#bytes", { with: { type: "bytes" } })).default, different)
await assert.rejects(import.source("./resource.mjs"), SyntaxError)
assert.equal(bytes.buffer.immutable, true)
for (const write of [
  () => { bytes[0] = 0 },
  () => { new Uint8Array(bytes.buffer)[0] = 0 },
  () => new DataView(bytes.buffer).setUint8(0, 0),
  () => bytes.buffer.resize(0),
  () => bytes.buffer.transfer(),
  () => bytes.buffer.transferToImmutable()
]) assert.throws(write, TypeError)
assert.deepEqual(Buffer.from(bytes), raw)
assert.equal(globalThis.__esmSyncValueResourceRuns, undefined)
assert.equal((await import("./resource.mjs")).default, 23)
assert.equal(globalThis.__esmSyncValueResourceRuns, 1)
console.log("bytes-imports:pass")
