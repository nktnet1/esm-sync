import path from "node:path"
import { it } from "vitest"
import { withCompatibilityFiles } from "./helpers/coverage.ts"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loader = path.resolve(testPath, "../esm.js")
const benchmark = path.resolve(testPath, "../../script/src/benchmark-log4brains.ts")

for (const workload of ["version", "preview"]) {
  it(`compares equivalent ${workload} startups with private cold/warm compiler and bootstrap caches`, async ({
    expect
  }) => {
    await withCompatibilityFiles(
      {
        "packages/global-cli/dist/index.js": `require = require('esm')(module, {mainFields:['module','main']}); module.exports=require('./main.js')`,
        "packages/global-cli/dist/main.js":
          workload === "version"
            ? `import assert from 'node:assert/strict'; assert.ok(process.argv.includes('--version')); console.log('1.0.0')`
            : `import http from 'node:http'; http.createServer((req,res)=>res.end('Log4brains fixture')).listen(0)`
      },
      async (directory) => {
        const result = await runNode(
          [
            benchmark,
            `--project=${directory}`,
            `--baseline=${loader}`,
            `--loader=${loader}`,
            `--workload=${workload}`,
            "--iterations=2",
            "--json"
          ],
          testEnvironments[0]!,
          {},
          { cwd: path.resolve(testPath, ".."), timeout: 60_000 }
        )
        expect(result.exitCode, result.stderr).toBe(0)
        const report = JSON.parse(result.stdout) as {
          entry: string
          workload: string
          loaders: Record<string, { runtimeSHA256: string; cache: string; bootstrapCache: string }>
          samples: {
            iteration: number
            cache: string
            loader: string
            output: string
            elapsedMs: number
            cpuUserMs: number
            bootstrapCached: boolean
            compilerCached: boolean
          }[]
        }
        expect(report.entry).toBe(path.join(directory, "packages/global-cli/dist/index.js"))
        expect(report.workload).toBe(workload)
        expect(report.loaders.baseline!.runtimeSHA256).toBe(report.loaders.fork!.runtimeSHA256)
        expect(report.loaders.baseline!.cache).not.toBe(report.loaders.fork!.cache)
        expect(report.loaders.baseline!.bootstrapCache).not.toBe(
          report.loaders.fork!.bootstrapCache
        )
        expect(
          report.samples.map(({ iteration, cache, loader }) => [iteration, cache, loader])
        ).toStrictEqual([
          [0, "cold", "baseline"],
          [0, "cold", "fork"],
          [0, "warm", "baseline"],
          [0, "warm", "fork"],
          [1, "cold", "fork"],
          [1, "cold", "baseline"],
          [1, "warm", "fork"],
          [1, "warm", "baseline"]
        ])
        expect(new Set(report.samples.map((sample) => sample.output)).size).toBe(1)
        for (const sample of report.samples) {
          expect(sample.elapsedMs).toBeGreaterThan(0)
          expect(sample.cpuUserMs).toBeGreaterThan(0)
          expect(sample.bootstrapCached).toBe(sample.cache === "warm")
          expect(sample.compilerCached).toBe(sample.cache === "warm")
        }
      }
    )
  }, 90_000)
}

it("rejects timings for different application output", async ({ expect }) => {
  await withCompatibilityFiles(
    {
      "packages/global-cli/dist/index.js": `require('esm')(module)('./main.js')`,
      "packages/global-cli/dist/main.js": `export const ready = true; console.log(process.env.BENCH_LOADER.includes('baseline') ? '1.0.0' : '2.0.0')`
    },
    async (directory) => {
      const result = await runNode(
        [
          benchmark,
          `--project=${directory}`,
          `--baseline=${loader}`,
          `--loader=${loader}`,
          "--iterations=1",
          "--json"
        ],
        testEnvironments[0]!,
        {},
        { timeout: 30_000 }
      )
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("Application responses differ")
    }
  )
}, 60_000)

it("rejects a preview process that exits before serving HTTP", async ({ expect }) => {
  await withCompatibilityFiles(
    {
      "packages/global-cli/dist/index.js": "console.log('Log4brains')"
    },
    async (directory) => {
      const result = await runNode(
        [
          benchmark,
          `--project=${directory}`,
          `--baseline=${loader}`,
          `--loader=${loader}`,
          "--iterations=1",
          "--workload=preview",
          "--json"
        ],
        testEnvironments[0]!,
        {},
        { timeout: 30_000 }
      )
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("Child exited before HTTP readiness")
    }
  )
}, 60_000)
