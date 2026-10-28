import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import execa from "execa"
import { it, expect } from "vitest"
import { testPath } from "./helpers/run-node.ts"

type ConformanceReport = {
  selected: number
  passed: number
  failed: number
  unsupported: number
  complete: boolean
  cases: Array<{
    path: string
    status: string
    expectedError: string | null
    expectedPhase: string | null
  }>
}

const prefix = "test/language/import/import-defer/errors/"
const expectedPaths = [
  "get-other-while-dep-evaluating/main.js",
  "get-other-while-evaluating/main.js",
  "get-self-while-defer-evaluating/main.js",
  "get-self-while-evaluating.js",
  "module-throws/defer-import-after-evaluation.js",
  "module-throws/third-party-evaluation-after-defer-import.js",
  "module-throws/trigger-evaluation.js",
  "resolution-error/import-defer-of-missing-module-fails.js",
  "syntax-error/import-defer-of-syntax-error-fails.js"
].map((relativePath) => `${prefix}${relativePath}`)

it("preserves deferred-import error handling without top-level await", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-deferred-errors-"))

  try {
    const runner = path.resolve(testPath, "../script/run-test262.js")
    const reportPath = path.join(directory, "report.json")
    const { exitCode, stdout, stderr, timedOut } = await execa(
      process.execPath,
      [
        runner,
        "--filter",
        "import/import-defer/errors/",
        "--exclude-feature",
        "top-level-await",
        "--reporter",
        "dot",
        "--report",
        reportPath
      ],
      {
        cwd: path.dirname(runner),
        reject: false,
        timeout: 30_000
      }
    )

    expect(timedOut).toBe(false)
    expect(exitCode, stderr || stdout).toBe(0)

    const report = JSON.parse(await readFile(reportPath, "utf8")) as ConformanceReport
    expect(report.complete).toBe(true)
    expect(report.selected).toBe(expectedPaths.length)
    expect(report.passed).toBe(expectedPaths.length)
    expect(report.failed).toBe(0)
    expect(report.unsupported).toBe(0)
    expect(report.cases.map(({ path: filename }) => filename).sort()).toStrictEqual(
      [...expectedPaths].sort()
    )
    expect(report.cases.map(({ status }) => status)).toStrictEqual(
      Array.from({ length: expectedPaths.length }, () => "pass")
    )
    expect(
      report.cases
        .filter(({ expectedError, expectedPhase }) => expectedError && expectedPhase)
        .map(({ path: filename, expectedError, expectedPhase }) => ({
          filename,
          expectedError,
          expectedPhase
        }))
    ).toStrictEqual([
      {
        filename: `${prefix}syntax-error/import-defer-of-syntax-error-fails.js`,
        expectedError: "SyntaxError",
        expectedPhase: "resolution"
      }
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 35_000)
