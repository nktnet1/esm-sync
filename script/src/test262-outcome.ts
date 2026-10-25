"use strict"

import assert from "node:assert/strict"

const phases = new Set(["parse", "resolution", "runtime"])

function assertTest262Outcome(
  filename: string,
  stdout: string,
  expectedError?: string,
  expectedPhase?: string
): void {
  if (!stdout.trim()) {
    assert.equal(
      expectedError,
      undefined,
      `${filename}: expected ${expectedError}, but no error occurred`
    )
    return
  }

  let result: unknown
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
    typeof (result as Record<string, unknown>).name === "string" &&
      (result as { name: string }).name.length > 0,
    `${filename}: invalid error name`
  )
  assert.ok(
    phases.has((result as { phase: string }).phase),
    `${filename}: unknown error phase: ${(result as Record<string, unknown>).phase}`
  )
  const detail = (result as Record<string, unknown>).message
    ? `: ${(result as Record<string, unknown>).message}`
    : ""
  assert.equal(
    (result as Record<string, unknown>).name,
    expectedError,
    `${filename}: unexpected error type${detail}`
  )
  assert.equal(
    (result as Record<string, unknown>).phase,
    expectedPhase,
    `${filename}: unexpected error phase${detail}`
  )
}

export = { assertTest262Outcome }
