import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { describe, it } from "vitest"

const require = createRequire(import.meta.url)
const { selectCases, createReport } = require("../../script/test262-selection.js") as {
  selectCases: (
    cases: Array<{ relativePath: string; skippedReason?: string }>,
    options?: { filter?: string; limit?: number }
  ) => Array<{ relativePath: string; skippedReason?: string }>
  createReport: (options: {
    revision: string
    selected: number
    excluded: number
    results: Array<{ path: string; status: string }>
    runtime: string
    platform: string
  }) => {
    passed: number
    failed: number
    complete: boolean
    failuresByGroup: Record<string, number>
    cases: Array<{ path: string; status: string }>
  }
}

const cases = [
  { relativePath: "test/language/module-code/ambiguous-export.js" },
  { relativePath: "test/language/expressions/dynamic-import/basic.js" },
  {
    relativePath: "test/language/expressions/dynamic-import/excluded.js",
    skippedReason: "existing exclusion"
  },
  { relativePath: "test\\language\\module-code\\another-export.js" }
]

describe("Test262 case selection", () => {
  it("filters by case-insensitive path text, including Windows separators", () => {
    const selected = selectCases(cases, { filter: "MODULE-CODE" })
    assert.deepEqual(
      selected.map(({ relativePath }) => relativePath),
      [cases[0].relativePath, cases[3].relativePath]
    )
  })

  it("applies the limit after filtering and excluding known cases", () => {
    const selected = selectCases(cases, { filter: "dynamic-import", limit: 1 })
    assert.deepEqual(
      selected.map(({ relativePath }) => relativePath),
      [cases[1].relativePath]
    )
  })

  it("rejects an empty selection and invalid limits", () => {
    assert.throws(
      () => selectCases(cases, { filter: "not-present" }),
      /No runnable Test262 cases match/
    )
    assert.throws(() => selectCases(cases, { limit: 0 }), /positive integer/)
    assert.throws(() => selectCases(cases, { limit: 1.5 }), /positive integer/)
  })
})

describe("Test262 JSON result reports", () => {
  it("sorts cases, counts failures by directory, and records completeness", () => {
    const report = createReport({
      revision: "example-revision",
      selected: 3,
      excluded: 1,
      runtime: "v26.0.0",
      platform: "win32",
      results: [
        { path: "test/language/module-code/b.js", status: "fail" },
        { path: "test/language/expressions/dynamic-import/a.js", status: "fail" },
        { path: "test/language/module-code/a.js", status: "pass" }
      ]
    })

    assert.equal(report.passed, 1)
    assert.equal(report.failed, 2)
    assert.equal(report.complete, true)
    assert.deepEqual(report.failuresByGroup, {
      "expressions/dynamic-import": 1,
      "module-code": 1
    })
    assert.deepEqual(
      report.cases.map(({ path }) => path),
      [
        "test/language/expressions/dynamic-import/a.js",
        "test/language/module-code/a.js",
        "test/language/module-code/b.js"
      ]
    )
  })

  it("identifies partial reports", () => {
    const report = createReport({
      revision: "example-revision",
      selected: 5,
      excluded: 0,
      runtime: "v26.0.0",
      platform: "linux",
      results: [{ path: "test/language/export/one.js", status: "pass" }]
    })

    assert.equal(report.complete, false)
  })
})
