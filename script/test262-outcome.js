"use strict"

const assert = require("node:assert/strict")

const phases = new Set(["parse", "resolution", "runtime"])

function assertTest262Outcome(filename, stdout, expectedError, expectedPhase) {
  if (!stdout.trim()) {
    assert.equal(
      expectedError,
      undefined,
      `${filename}: expected ${expectedError}, but no error occurred`
    )
    return
  }

  let result
  try {
    result = JSON.parse(stdout.trim())
  } catch {
    throw new Error(`${filename}: invalid Test262 error report`)
  }

  assert.ok(
    result !== null && typeof result === "object",
    `${filename}: invalid Test262 error report`
  )
  assert.ok(
    typeof result.name === "string" && result.name.length > 0,
    `${filename}: invalid error name`
  )
  assert.ok(phases.has(result.phase), `${filename}: unknown error phase: ${result.phase}`)
  assert.equal(result.name, expectedError, `${filename}: unexpected error type`)
  assert.equal(result.phase, expectedPhase, `${filename}: unexpected error phase`)
}

module.exports = { assertTest262Outcome }
