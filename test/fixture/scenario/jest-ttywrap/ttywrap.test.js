"use strict"

test("importing esm-sync does not initialize process.stdin", () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "stdin")
  expect(descriptor).toBeDefined()
  expect(typeof descriptor.get).toBe("function")

  let reads = 0
  Object.defineProperty(process, "stdin", {
    ...descriptor,
    get() {
      reads++
      return descriptor.get.call(this)
    }
  })

  try {
    expect(typeof require("../../../../esm.js")).toBe("function")
    expect(reads).toBe(0)
  } finally {
    Object.defineProperty(process, "stdin", descriptor)
  }
})
