import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { describe, it, expect } from "vitest"

const require = createRequire(import.meta.url)
const {
  selectCases,
  createReport,
  detectHostFeatures,
  detectLoaderFeatures,
  getUnsupportedFeatures,
  getUnsupportedHostFeatures,
  getUnsupportedLoaderFeatures,
  isGeneratedGrammarCase
} = require("../../dist/script/test262-selection.js") as {
  isGeneratedGrammarCase: (options: {
    relativePath: string
    flags?: { generated?: boolean; async?: boolean; module?: boolean }
    source: string
    includes?: string[]
    expectedError?: string
    expectedPhase?: string
  }) => boolean
  detectHostFeatures: () => Promise<Record<string, boolean>>
  detectLoaderFeatures: () => Record<string, boolean>
  getUnsupportedFeatures: (features: string[], hostFeatures: Record<string, boolean>) => string[]
  getUnsupportedHostFeatures: (
    testCase: {
      features: string[]
      isModule?: boolean
      expectedPhase?: string
      syntaxOnly?: boolean
    },
    hostFeatures: Record<string, boolean>
  ) => string[]
  getUnsupportedLoaderFeatures: (
    testCase: { features: string[]; relativePath: string; expectedPhase?: string },
    loaderFeatures: Record<string, boolean>
  ) => string[]
  selectCases: (
    cases: Array<{ relativePath: string; skippedReason?: string; features?: string[] }>,
    options?: { filter?: string; limit?: number; excludeFeatures?: string[] }
  ) => Array<{ relativePath: string; skippedReason?: string; features?: string[] }>
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
    expect(selected.map(({ relativePath }) => relativePath)).toStrictEqual([
      cases[0]!.relativePath,
      cases[3]!.relativePath
    ])
  })

  it("applies the limit after filtering and excluding known cases", () => {
    const selected = selectCases(cases, { filter: "dynamic-import", limit: 1 })
    expect(selected.map(({ relativePath }) => relativePath)).toStrictEqual([cases[1]!.relativePath])
  })

  it("excludes only explicitly tagged features before applying the limit", () => {
    const tagged = [
      { relativePath: "test/language/defer/sync.js", features: ["import-defer"] },
      {
        relativePath: "test/language/defer/async.js",
        features: ["import-defer", "top-level-await"]
      },
      { relativePath: "test/language/defer/untagged.js" },
      { relativePath: "test/language/defer/extra.js", features: ["async-iteration"] }
    ]

    expect(
      selectCases(tagged, {
        filter: "defer/",
        excludeFeatures: ["top-level-await"],
        limit: 2
      }).map(({ relativePath }) => relativePath)
    ).toStrictEqual([tagged[0]!.relativePath, tagged[2]!.relativePath])
    expect(selectCases(tagged).length).toBe(4)
    expect(
      selectCases(tagged, { excludeFeatures: ["top-level-await", "async-iteration"] }).map(
        ({ relativePath }) => relativePath
      )
    ).toStrictEqual([tagged[0]!.relativePath, tagged[2]!.relativePath])
  })

  it("rejects empty feature filters instead of succeeding with no tests", () => {
    expect(() => selectCases(cases, { excludeFeatures: [""] })).toThrow(
      /excluded features must be non-empty/
    )
    expect(() =>
      selectCases(cases, { filter: "not-present", excludeFeatures: ["top-level-await"] })
    ).toThrow(/No runnable Test262 cases match the path filter/)
    expect(() =>
      selectCases([{ relativePath: "one.js", features: ["top-level-await"] }], {
        excludeFeatures: ["top-level-await"]
      })
    ).toThrow(/No runnable Test262 cases remain/)
  })

  it("rejects an empty selection and invalid limits", () => {
    expect(() => selectCases(cases, { filter: "not-present" })).toThrow(
      /No runnable Test262 cases match/
    )
    expect(() => selectCases(cases, { limit: 0 })).toThrow(/positive integer/)
    expect(() => selectCases(cases, { limit: 1.5 })).toThrow(/positive integer/)
  })
})

describe("Test262 generated grammar-only cases", () => {
  const relativePath =
    "test/language/expressions/dynamic-import/syntax/valid/nested-if-empty-str-is-valid-assign-expr.js"
  const source = `// This file was procedurally generated from the following sources:
// - src/dynamic-import/empty-str-is-valid-assign-expr.case
// - src/dynamic-import/syntax/valid/nested-if.template
/*---
flags: [generated]
---*/
"use script";
if (true) import("");`

  it("parses generated ImportCall grammar without executing unobserved rejections", () => {
    expect(isGeneratedGrammarCase({ relativePath, flags: { generated: true }, source })).toBe(true)
    expect(
      isGeneratedGrammarCase({
        relativePath: relativePath.replaceAll("/", "\\"),
        flags: { generated: true },
        source
      })
    ).toBe(true)
  })

  it("keeps cases with actual assertions, completion callbacks, or expected errors executable", () => {
    const generated = { relativePath, flags: { generated: true }, source }
    for (const body of [
      "assert.sameValue(then, Promise.prototype.then)",
      "assert.throws(TypeError, () => import('missing'))",
      "$DONE()",
      "throw new Error('runtime failure')"
    ]) {
      expect(isGeneratedGrammarCase({ ...generated, source: `${source}\n${body}` })).toBe(false)
    }
    expect(isGeneratedGrammarCase({ ...generated, expectedPhase: "runtime" })).toBe(false)
    expect(isGeneratedGrammarCase({ ...generated, expectedError: "SyntaxError" })).toBe(false)
    expect(isGeneratedGrammarCase({ ...generated, includes: ["assert.js"] })).toBe(false)
    expect(isGeneratedGrammarCase({ ...generated, flags: { generated: true, async: true } })).toBe(
      false
    )
    expect(isGeneratedGrammarCase({ ...generated, flags: { generated: true, module: true } })).toBe(
      false
    )
  })

  it("does not infer syntax-only handling from directory names alone", () => {
    const generated = { relativePath, flags: { generated: true }, source }
    expect(isGeneratedGrammarCase({ ...generated, flags: {} })).toBe(false)
    expect(
      isGeneratedGrammarCase({
        ...generated,
        relativePath: relativePath.replace("syntax/valid", "catch")
      })
    ).toBe(false)
    expect(
      isGeneratedGrammarCase({
        ...generated,
        source: source.replace("/nested-if.template", "/another.case")
      })
    ).toBe(false)
    expect(isGeneratedGrammarCase({ ...generated, source: source.replace("---*/", "--*/") })).toBe(
      false
    )
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

    expect(report.passed).toBe(1)
    expect(report.failed).toBe(2)
    expect(report.complete).toBe(true)
    expect(report.failuresByGroup).toStrictEqual({
      "expressions/dynamic-import": 1,
      "module-code": 1
    })
    expect(report.cases.map(({ path }) => path)).toStrictEqual([
      "test/language/expressions/dynamic-import/a.js",
      "test/language/module-code/a.js",
      "test/language/module-code/b.js"
    ])
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

    expect(report.complete).toBe(false)
  })
})

describe("Test262 unsupported engine feature classification", () => {
  it("probes native capabilities without assuming a particular Node version", async () => {
    const features = await detectHostFeatures()
    expect(typeof features["immutable-arraybuffer"]).toBe("boolean")
    expect(typeof features["nonextensible-applies-to-private"]).toBe("boolean")
    expect(typeof features["import-text"]).toBe("boolean")

    const flags = require("../../dist/script/test262-node-flags.js") as string[]
    const immutable = execFileSync(
      process.execPath,
      [
        ...flags,
        "-e",
        `
try { process.stdout.write(String(new ArrayBuffer(0).transferToImmutable().immutable)) }
catch { process.stdout.write('false') }
`
      ],
      { encoding: "utf8" }
    )
    expect(features["immutable-arraybuffer"]).toBe(immutable === "true")
  })

  it("uses esm-sync text imports in both source goals and parse-only cases", () => {
    const features = ["import-text", "import-attributes"]
    const unavailable = { "import-text": false }
    const available = { "import-text": true }
    const script = { features, isModule: false }

    expect(getUnsupportedHostFeatures(script, unavailable)).toStrictEqual([])
    expect(getUnsupportedHostFeatures(script, available)).toStrictEqual([])
    expect(getUnsupportedHostFeatures({ ...script, isModule: true }, unavailable)).toStrictEqual([])
    expect(getUnsupportedHostFeatures({ ...script, syntaxOnly: true }, unavailable)).toStrictEqual(
      []
    )
    expect(
      getUnsupportedHostFeatures({ ...script, expectedPhase: "parse" }, unavailable)
    ).toStrictEqual([])
  })

  it("reports missing immutable buffers as unsupported by the host, not as a pass", () => {
    const missing = getUnsupportedHostFeatures(
      { features: ["immutable-arraybuffer"], isModule: true },
      { "immutable-arraybuffer": false }
    )
    const report = createReport({
      revision: "example-revision",
      selected: 1,
      excluded: 0,
      runtime: "v26.0.0",
      platform: "linux",
      results: [
        {
          path: "test/language/import/import-bytes/bytes-from-empty.js",
          status: "unsupported",
          unsupportedFeatureSources: { host: missing, loader: [] }
        }
      ]
    })

    expect(report.passed).toBe(0)
    expect(report.failed).toBe(0)
    expect(report.unsupported).toBe(1)
    expect(report.unsupportedByOrigin).toStrictEqual({ host: 1, loader: 0 })
    expect(report.complete).toBe(true)
  })

  it("only excludes recognized capabilities missing from the host", () => {
    const features = [
      "import-attributes",
      "immutable-arraybuffer",
      "import-bytes",
      "nonextensible-applies-to-private"
    ]
    expect(
      getUnsupportedFeatures(features, {
        "immutable-arraybuffer": false,
        "nonextensible-applies-to-private": false
      })
    ).toStrictEqual(["immutable-arraybuffer", "nonextensible-applies-to-private"])
    expect(
      getUnsupportedFeatures(features, {
        "immutable-arraybuffer": true,
        "nonextensible-applies-to-private": true
      })
    ).toStrictEqual([])
  })

  it("declares implemented loader features and can classify an unavailable loader", () => {
    const implemented = detectLoaderFeatures()
    expect(implemented["source-phase-imports-module-source"]).toBe(true)
    expect(implemented["import-bytes"]).toBe(true)
    const loaderFeatures = { "source-phase-imports-module-source": false }
    expect(getUnsupportedFeatures(["source-phase-imports"], loaderFeatures)).toStrictEqual([])
    expect(
      getUnsupportedFeatures(
        ["source-phase-imports", "source-phase-imports-module-source"],
        loaderFeatures
      )
    ).toStrictEqual(["source-phase-imports-module-source"])
    expect(
      getUnsupportedFeatures(["source-phase-imports-module-source"], {
        "source-phase-imports-module-source": true
      })
    ).toStrictEqual([])

    const features = ["source-phase-imports", "source-phase-imports-module-source"]
    const runtimeModule = {
      features,
      relativePath:
        "test/language/module-code/source-phase-import/reexport-source-binding-named-import.js"
    }
    expect(getUnsupportedLoaderFeatures(runtimeModule, loaderFeatures)).toStrictEqual([
      "source-phase-imports-module-source"
    ])
    expect(
      getUnsupportedLoaderFeatures({ ...runtimeModule, expectedPhase: "parse" }, loaderFeatures)
    ).toStrictEqual([])
    expect(
      getUnsupportedLoaderFeatures(
        {
          features,
          relativePath:
            "test\\language\\expressions\\dynamic-import\\syntax\\valid\\top-level-import-source-script-code-valid.js"
        },
        loaderFeatures
      )
    ).toStrictEqual([])
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
    expect(report.selected).toBe(4)
    expect(report.unsupported).toBe(3)
    expect(report.unsupportedByOrigin).toStrictEqual({ host: 2, loader: 1 })
    expect(report.failed).toBe(0)
    expect(report.passed).toBe(1)
    expect(report.complete).toBe(true)
    expect(report.failuresByGroup).toStrictEqual({})
  })
})
