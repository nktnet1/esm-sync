globalThis.__packedDeferredEvents = ["async:start"]
await new Promise((resolve) => setImmediate(resolve))
globalThis.__packedDeferredEvents.push("async:done")
export const value = 42
