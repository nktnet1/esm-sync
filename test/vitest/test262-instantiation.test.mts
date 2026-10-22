import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import execa from "execa"
import { it } from "vitest"
import { testPath } from "./helpers/run-node.mts"

type ConformanceCase = {
  path: string
  status: string
  expectedError: string | null
  expectedPhase: string | null
}

type ConformanceReport = {
  selected: number
  passed: number
  failed: number
  unsupported: number
  complete: boolean
  cases: ConformanceCase[]
}

it("preserves the pinned Test262 module-instantiation cases", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-instantiation-"))

  try {
    const runner = path.resolve(testPath, "../script/run-test262.js")
    const reportPath = path.join(directory, "report.json")
    const { exitCode, stderr, stdout, timedOut } = await execa(
      process.execPath,
      [runner, "--filter", "module-code/instn-", "--reporter", "dot", "--report", reportPath],
      {
        cwd: path.dirname(runner),
        reject: false,
        timeout: 85_000
      }
    )

    assert.equal(timedOut, false)
    assert.equal(exitCode, 0, stderr || stdout)

    const report = JSON.parse(await readFile(reportPath, "utf8")) as ConformanceReport
    assert.equal(report.complete, true)
    assert.equal(report.selected, 76)
    assert.equal(report.passed, 76)
    assert.equal(report.failed, 0)
    assert.equal(report.unsupported, 0)
    assert.equal(report.cases.length, 76)
    assert.ok(report.cases.every(({ status }) => status === "pass"))

    // Preserve both successful linking and early SyntaxErrors. Excluding the
    // negative cases would otherwise produce a misleading green report.
    assert.equal(
      report.cases.filter(
        ({ expectedError, expectedPhase }) =>
          expectedError === "SyntaxError" && expectedPhase === "resolution"
      ).length,
      18
    )
    assert.equal(
      report.cases.filter(
        ({ expectedError, expectedPhase }) => expectedError === null && expectedPhase === null
      ).length,
      58
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 90_000)
