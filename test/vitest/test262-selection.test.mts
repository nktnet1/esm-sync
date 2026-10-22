import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { describe, it } from "vitest"

const require = createRequire(import.meta.url)
const {
  selectCases,
  createReport,
  detectHostFeatures,
  detectLoaderFeatures,
  getUnsupportedFeatures,
  getUnsupportedLoaderFeatures
} = require("../../script/test262-selection.js") as {
  detectHostFeatures: () => Record<string, boolean>
  detectLoaderFeatures: () => Record<string, boolean>
  getUnsupportedFeatures: (features: string[], hostFeatures: Record<string, boolean>) => string[]
  getUnsupportedLoaderFeatures: (
    testCase: { features: string[]; relativePath: string; expectedPhase?: string },
    loaderFeatures: Record<string, boolean>
  ) => string[]
  selectCases: (
    cases: Array<{ relativePath: string; skippedReason?: string }>,
    options?: { filter?: string; limit?: number }
  ) => Array<{ relativePath: string; skippedReason?: string }>
  createReport: (options: {
    revision: string
    selected: number
    excluded: number
    results: Array<{
      path: string
      status: string
      unsupportedFeatureSources?: { host: string[]; loader: string[] }
    }>
    runtime: string
    platform: string
  }) => {
    selected: number
    excluded: number
    passed: number
    failed: number
    unsupported: number
    unsupportedByOrigin: { host: number; loader: number }
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

describe("Test262 unsupported engine feature classification", () => {
  it("probes native capabilities without assuming a particular Node version", () => {
    const features = detectHostFeatures()
    assert.equal(typeof features["immutable-arraybuffer"], "boolean")
    assert.equal(typeof features["nonextensible-applies-to-private"], "boolean")
  })

  it("only excludes recognized capabilities missing from the host", () => {
    const features = [
      "import-attributes",
      "immutable-arraybuffer",
      "import-bytes",
      "nonextensible-applies-to-private"
    ]
    assert.deepEqual(
      getUnsupportedFeatures(features, {
        "immutable-arraybuffer": false,
        "nonextensible-applies-to-private": false
      }),
      ["immutable-arraybuffer", "nonextensible-applies-to-private"]
    )
    assert.deepEqual(
      getUnsupportedFeatures(features, {
        "immutable-arraybuffer": true,
        "nonextensible-applies-to-private": true
      }),
      []
    )
  })

  it("gates only loader ModuleSource requirements, not source-phase syntax cases", () => {
    const loaderFeatures = detectLoaderFeatures()
    assert.equal(loaderFeatures["source-phase-imports-module-source"], false)
    assert.deepEqual(getUnsupportedFeatures(["source-phase-imports"], loaderFeatures), [])
    assert.deepEqual(
      getUnsupportedFeatures(
        ["source-phase-imports", "source-phase-imports-module-source"],
        loaderFeatures
      ),
      ["source-phase-imports-module-source"]
    )
    assert.deepEqual(
      getUnsupportedFeatures(["source-phase-imports-module-source"], {
        "source-phase-imports-module-source": true
      }),
      []
    )

    const features = ["source-phase-imports", "source-phase-imports-module-source"]
    const runtimeModule = {
      features,
      relativePath:
        "test/language/module-code/source-phase-import/reexport-source-binding-named-import.js"
    }
    assert.deepEqual(getUnsupportedLoaderFeatures(runtimeModule, loaderFeatures), [
      "source-phase-imports-module-source"
    ])
    assert.deepEqual(
      getUnsupportedLoaderFeatures({ ...runtimeModule, expectedPhase: "parse" }, loaderFeatures),
      []
    )
    assert.deepEqual(
      getUnsupportedLoaderFeatures(
        {
          features,
          relativePath:
            "test\\language\\expressions\\dynamic-import\\syntax\\valid\\top-level-import-source-script-code-valid.js"
        },
        loaderFeatures
      ),
      []
    )
  })

  it("reports unsupported cases separately from failures and still counts them as selected", () => {
    const report = createReport({
      revision: "example-revision",
      selected: 4,
      excluded: 0,
      runtime: "v24.0.0",
      platform: "linux",
      results: [
        {
          path: "test/language/import/import-bytes/bytes-from-js.js",
          status: "unsupported",
          unsupportedFeatureSources: { host: ["immutable-arraybuffer"], loader: [] }
        },
        {
          path: "test/language/import/import-defer/evaluation-triggers/private.js",
          status: "unsupported",
          unsupportedFeatureSources: { host: ["nonextensible-applies-to-private"], loader: [] }
        },
        {
          path: "test/language/module-code/source-phase-import/reexport-source-binding-named-import.js",
          status: "unsupported",
          unsupportedFeatureSources: { host: [], loader: ["source-phase-imports-module-source"] }
        },
        { path: "test/language/module-code/exports.js", status: "pass" }
      ]
    })
    assert.equal(report.selected, 4)
    assert.equal(report.unsupported, 3)
    assert.deepEqual(report.unsupportedByOrigin, { host: 2, loader: 1 })
    assert.equal(report.failed, 0)
    assert.equal(report.passed, 1)
    assert.equal(report.complete, true)
    assert.deepEqual(report.failuresByGroup, {})
  })
})
