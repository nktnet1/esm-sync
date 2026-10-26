"use strict"

function createRequire() {
  return require("../../../../index.js")(module)
}

beforeEach(() => jest.resetModules())

test("CJS dependencies share constructors across an ESM graph", () => {
  const load = createRequire()
  const { schema, Type, value } = load("./main.mjs")

  expect(value.number).toBe(1)
  expect(value instanceof Type).toBe(true)
  expect(value).toBeInstanceOf(Type)
  expect(Object.getPrototypeOf(value)).toBe(Type.prototype)
  expect(schema.Type).toBe(load("./type.js"))
  expect(schema.Type.prototype).toBe(Type.prototype)
  expect(schema.value).toBe(load("./value.js"))
  expect(load("./schema.js")).toBe(load("./schema.js"))
  expect(schema.accepts(new Type())).toBe(true)
  expect(schema.accepts({})).toBe(false)
  expect(value instanceof function OtherType() {}).toBe(false)
})

test("reuses constructors already loaded by Jest", () => {
  const Type = require("./type.js")
  const { schema, value } = createRequire()("./main.mjs")

  expect(schema.Type).toBe(Type)
  expect(value instanceof Type).toBe(true)
})

test("sees Jest modules loaded after the loader was created", () => {
  const load = createRequire()
  const Type = require("./type.js")

  expect(load("./type.js")).toBe(Type)
  expect(load("./main.mjs").value instanceof Type).toBe(true)
})

test("separate loader factories share CommonJS constructors and cache invalidation", () => {
  const first = createRequire()
  const Type = first("./type.js")
  const second = createRequire()

  expect(second("./type.js")).toBe(Type)
  expect(second("./value.js") instanceof Type).toBe(true)

  delete first.cache[first.resolve("./type.js")]
  const nextType = second("./type.js")
  expect(nextType).not.toBe(Type)
  expect(first("./type.js")).toBe(nextType)
})

test("exposes and invalidates loader-created CommonJS cache entries", () => {
  const load = createRequire()
  const Type = load("./type.js")
  const filename = load.resolve("./type.js")

  expect(load.cache[filename].exports).toBe(Type)
  expect(filename in load.cache).toBe(true)
  expect(Object.keys(load.cache)).toContain(filename)
  expect(Object.getOwnPropertyDescriptor(load.cache, filename).value.exports).toBe(Type)
  expect(Object.prototype.hasOwnProperty.call(load.cache, filename)).toBe(true)

  delete load.cache[filename]

  expect(load.cache[filename]).toBeUndefined()
  expect(filename in load.cache).toBe(false)
  expect(Object.keys(load.cache)).not.toContain(filename)
  expect(Object.getOwnPropertyDescriptor(load.cache, filename)).toBeUndefined()
  expect(load("./type.js")).not.toBe(Type)
})

test("a new loader gets fresh constructors after jest.resetModules", () => {
  const first = createRequire()("./main.mjs")
  jest.resetModules()
  const second = createRequire()("./main.mjs")

  expect(second.Type).not.toBe(first.Type)
  expect(second.value.number).toBe(1)
  expect(second.value instanceof second.Type).toBe(true)
  expect(first.value instanceof second.Type).toBe(false)
})

test("failed CommonJS evaluations are evicted so a subsequent load can retry", () => {
  const load = createRequire()
  const filename = load.resolve("./retry.js")

  expect(() => load("./retry.js")).toThrow("First load failed")
  expect(load.cache[filename]).toBeUndefined()

  const value = load("./retry.js")
  expect(value.number).toBe(2)
  expect(value instanceof load("./type.js")).toBe(true)
  expect(load("./retry.js")).toBe(value)
})
