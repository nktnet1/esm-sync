"use strict"

test("constructor state is isolated between Jest test files", () => {
  const load = require("../../../../index.js")(module)
  const { Type, value } = load("./main.mjs")

  expect(value.number).toBe(1)
  expect(value instanceof Type).toBe(true)
  expect(load("./value.js").number).toBe(1)
  expect(load("./value.js").constructor).toBe(load("./type.js"))
})
