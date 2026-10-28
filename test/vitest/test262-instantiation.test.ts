import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import execa from "execa"
import { it, expect } from "vitest"
import { testPath } from "./helpers/run-node.ts"

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

    expect(timedOut).toBe(false)
    expect(exitCode, stderr || stdout).toBe(0)

    const report = JSON.parse(await readFile(reportPath, "utf8")) as ConformanceReport
    expect(report.complete).toBe(true)
    expect(report.selected).toBe(76)
    expect(report.passed).toBe(76)
    expect(report.failed).toBe(0)
    expect(report.unsupported).toBe(0)
    expect(report.cases.length).toBe(76)
    expect(report.cases.map(({ status }) => status)).toStrictEqual(
      Array.from({ length: 76 }, () => "pass")
    )

    // Preserve both successful linking and early SyntaxErrors. Excluding the
    // negative cases would otherwise produce a misleading green report.
    expect(
      report.cases.filter(
        ({ expectedError, expectedPhase }) =>
          expectedError === "SyntaxError" && expectedPhase === "resolution"
      ).length
    ).toBe(18)
    expect(
      report.cases.filter(
        ({ expectedError, expectedPhase }) => expectedError === null && expectedPhase === null
      ).length
    ).toBe(58)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 90_000)
