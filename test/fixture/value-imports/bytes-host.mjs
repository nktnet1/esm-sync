import assert from "node:assert/strict"

if (typeof ArrayBuffer.prototype.transferToImmutable === "function") {
  await import("./bytes.mjs")
} else {
  await assert.rejects(
    import("./resource.mjs", { with: { type: "bytes" } }),
    { name: "TypeError", message: "Bytes imports require native immutable ArrayBuffer support" }
  )
  assert.equal(globalThis.__esmSyncValueResourceRuns, undefined)
  console.log("bytes-imports:unsupported-host")
}
