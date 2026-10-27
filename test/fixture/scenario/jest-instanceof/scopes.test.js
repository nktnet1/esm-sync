"use strict"

beforeEach(() => jest.resetModules())

function factory() {
  return require("../../../../index.js")
}

test("isolated ESM namespaces and their CommonJS dependencies stay in the same scope", () => {
  const load = factory()(module)
  let previous
  for (let index = 0; index < 2; index++) {
    jest.isolateModules(() => {
      const namespace = load("./main.mjs")
      const Type = load("./type.js")
      expect(namespace).not.toBe(previous)
      expect(namespace.schema.Type).toBe(Type)
      expect(namespace.value instanceof Type).toBe(true)
      expect(namespace.value.number).toBe(1)
      previous = namespace
    })
  }
})

test("retained loaders refresh the complete ESM graph after a registry reset", () => {
  const load = factory()(module)
  const previous = load("./main.mjs")
  jest.resetModules()
  const namespace = load("./main.mjs")
  expect(namespace).not.toBe(previous)
  expect(namespace.schema.Type).toBe(load("./type.js"))
  expect(namespace.value instanceof load("./type.js")).toBe(true)
  expect(namespace.value.number).toBe(1)
})

test("retained loaders keep independent isolated CJS graphs separate", () => {
  const load = factory()(module)
  const filename = load.resolve("./type.js")
  let previous

  for (let index = 0; index < 3; index++) {
    jest.isolateModules(() => {
      const schema = load("./schema.js")
      expect(schema.Type).not.toBe(previous)
      expect(schema.value.number).toBe(1)
      expect(schema.value instanceof schema.Type).toBe(true)
      expect(load("./type.js")).toBe(schema.Type)
      expect(load.cache[filename].exports).toBe(schema.Type)
      expect(filename in load.cache).toBe(true)
      expect(Object.keys(load.cache)).toContain(filename)
      previous = schema.Type
    })

    // Reflection between callbacks must not create an empty outer cache entry.
    expect(load.cache[filename]).toBeUndefined()
    expect(filename in load.cache).toBe(false)
    expect(Object.getOwnPropertyDescriptor(load.cache, filename)).toBeUndefined()
    expect(Object.keys(load.cache)).not.toContain(filename)
  }
})

test("new factories share constructors within an isolated registry", () => {
  const create = factory()
  let previous

  for (let index = 0; index < 2; index++) {
    jest.isolateModules(() => {
      const Type = create(module)("./type.js")
      expect(Type).not.toBe(previous)
      expect(create(module)("./type.js")).toBe(Type)
      expect(new Type().number).toBe(1)
      previous = Type
    })
  }
})

test("isolated exceptions do not leak CJS state into the outer registry", () => {
  const load = factory()(module)
  let isolated
  const failure = new Error("isolation failed")
  expect(() => jest.isolateModules(() => {
    isolated = load("./type.js")
    expect(new isolated().number).toBe(1)
    throw failure
  })).toThrow(failure)

  const Type = load("./type.js")
  expect(Type).not.toBe(isolated)
  expect(new Type().number).toBe(1)
})

test("outer constructors follow Jest's own inheritance rules", () => {
  const load = factory()(module)
  const Type = load("./type.js")
  const HostType = require("./host-type.js")
  expect(new Type().number).toBe(new HostType().number)

  jest.isolateModules(() => {
    const InnerType = load("./type.js")
    const InnerHostType = require("./host-type.js")
    expect(InnerType === Type).toBe(InnerHostType === HostType)
    expect(new InnerType().number).toBe(new InnerHostType().number)
  })

  expect(load("./type.js")).toBe(Type)
  expect(new Type().number).toBe(new HostType().number)
})

test("cache deletion and failed-load eviction stay inside their isolated registry", () => {
  const load = factory()(module)
  const filename = load.resolve("./type.js")
  for (let index = 0; index < 2; index++) {
    jest.isolateModules(() => {
      const Type = load("./type.js")
      delete load.cache[filename]
      expect(load.cache[filename]).toBeUndefined()
      expect(load("./type.js")).not.toBe(Type)
      expect(() => load("./retry.js")).toThrow("First load failed")
      expect(load("./retry.js").number).toBe(2)
    })
  }
})

test("isolated and outer loads share the registry after explicit resets", () => {
  const create = factory()
  const retained = create(module)
  jest.resetModules()
  const fresh = factory()(module)
  const Type = retained("./type.js")
  expect(fresh("./type.js")).toBe(Type)
  expect(Object.keys(fresh.cache)).toContain(fresh.resolve("./type.js"))
  fresh("./value.js")
  expect(Object.keys(retained.cache)).toContain(retained.resolve("./value.js"))
})

test("resetting mock functions does not reset the CommonJS module cache", () => {
  const load = factory()(module)
  const Type = load("./type.js")
  jest.clearAllMocks()
  jest.resetAllMocks()
  jest.restoreAllMocks()
  expect(load("./type.js")).toBe(Type)
})

test("cache bookkeeping does not execute application mocks of the package manifest", () => {
  const manifest = require.resolve("../../../../../package.json")
  jest.doMock(manifest, () => { throw new Error("Application manifest mock") })
  try {
    const load = factory()(module)
    expect(new (load("./type.js"))().number).toBe(1)
  } finally {
    jest.dontMock(manifest)
  }
})
