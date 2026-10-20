"use strict"

const setupAcorn = require("./setup-acorn.js")
const setupTest262 = require("./setup-test262.js")

const tasks = {
  acorn: setupAcorn,
  test262: setupTest262
}

const requested = process.argv.slice(2)
const fixtures = requested.length ? requested : Object.keys(tasks)

Promise.all(
  fixtures.map(async (fixture) => {
    if (!Object.hasOwn(tasks, fixture)) {
      throw new Error(`Unknown fixture: ${fixture}`)
    }

    return tasks[fixture]()
  })
).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
