"use strict"

import setupAcorn from "./setup-acorn.js"
import setupTest262 from "./setup-test262.js"
import setupNativeAddon from "./setup-native-addon.js"

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

    return tasks[fixture as keyof typeof tasks]()
  })
).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
