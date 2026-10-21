"use strict"

const setupAcorn = require("./setup-acorn.js")
const setupTest262 = require("./setup-test262.js")
const setupNativeAddon = require("./setup-native-addon.js")

const tasks = {
  acorn: setupAcorn,
  test262: setupTest262,
  native: setupNativeAddon
}

const requested = process.argv.slice(2)
// A native compiler is required only for test runs, not for builds or publishing.
const fixtures = requested.length ? requested : ["acorn", "test262"]

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
