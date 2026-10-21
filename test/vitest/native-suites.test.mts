import assert from "node:assert/strict"
import path from "node:path"
import { rm } from "node:fs/promises"
import { afterAll, beforeAll, describe, it } from "vitest"
import { collectNativeCases, location } from "./native-cases.mts"
import { runNode, testEnvironments, testPath, type NodeResult } from "./helpers/run-node.mts"

// The loader hooks and third-party runners need real Node, not Vite's module
// transformer. Each subprocess executes its entire suite exactly once; its
// individual node:test results are exposed as individual Vitest tests.
const nativeSuites = [
  "cache-tests.js",
  "dynamic-import-tests.mjs",
  "export-tests.mjs",
  "file-extension-tests.js",
  "import-tests.js",
  "misc-tests.js",
  "require-hook-tests.js",
  "scenario-tests.mjs",
  "setter-tests.js",
  "top-level-await-tests.js",
  "url-tests.mjs",
  "wasm-tests.js"
] as const

type TestRecord = {
  kind: "test"
  name: string
  line: number
  column: number
  status: "pass" | "fail" | "skip"
  error?: string | null
}
type SuiteRecord = { kind: "skipped-suite"; line: number; column: number }
type SummaryRecord = {
  kind: "summary"
  counts: { tests: number; failed: number; passed: number; skipped: number }
  success: boolean
}
type FailureRecord = { kind: "suite-failure"; name: string; error: string }
type NativeRecord = TestRecord | SuiteRecord | SummaryRecord | FailureRecord

const home = path.join(testPath, "env/home")
const nativeOptions = {
  ESM_OPTIONS: "{cjs:false,mode:'auto'}",
  HOME: home,
  USERPROFILE: home,
  NODE_PATH: [
    path.join(testPath, "env/node_path"),
    path.join(testPath, "env/node_path/relative")
  ].join(path.delimiter),
  NODE_PENDING_DEPRECATION: "1"
}

const reporterPrefix = "ESM_SYNC_TEST_EVENT "

function diagnostic(stdout: string, stderr: string) {
  const output = [stdout, stderr].filter(Boolean).join("\n")
  return output.length > 16000
    ? `${output.slice(0, 4000)}\n[... truncated ...]\n${output.slice(-12000)}`
    : output
}

function parseNativeRecords(stdout: string): NativeRecord[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(reporterPrefix))
    .map((line) => JSON.parse(line.slice(reporterPrefix.length)) as NativeRecord)
}

type NativeOutcome = { result: NodeResult } | { error: unknown }
type NativeJob = {
  suite: (typeof nativeSuites)[number]
  esmEnv: string
  timeout: number
  finish: (outcome: NativeOutcome) => void
}

const nativeJobs: NativeJob[] = []

function queueNativeSuite(suite: NativeJob["suite"], esmEnv: string, timeout: number) {
  let finish!: NativeJob["finish"]
  const result = new Promise<NativeOutcome>((resolve) => {
    finish = resolve
  })
  nativeJobs.push({ suite, esmEnv, timeout, finish })
  return result
}

async function executeNativeSuite(job: NativeJob): Promise<void> {
  // The loader caches compiled modules on disk by default. Concurrent native
  // processes must not overwrite or invalidate each other's cache metadata.
  // Keep the cache suite itself on the default path: it explicitly tests it.
  const cachePath = path.join(testPath, "env/native-cache", job.esmEnv, job.suite)
  const useDefaultCache = job.suite === "cache-tests.js"
  try {
    if (!useDefaultCache) await rm(cachePath, { recursive: true, force: true })
    const result = await runNode(
      [
        "--test-reporter=./native-test-reporter.cjs",
        "-r",
        "./native-test-bootstrap.cjs",
        "-r",
        "../index.js",
        "./native-suite.cjs",
        job.suite
      ],
      job.esmEnv,
      useDefaultCache
        ? nativeOptions
        : {
            ...nativeOptions,
            ESM_OPTIONS: JSON.stringify({ cjs: false, mode: "auto", cache: cachePath })
          },
      {
        timeout: job.timeout,
        executable: path.join(
          testPath,
          "env/prefix",
          process.platform === "win32" ? "node.exe" : "bin/node"
        )
      }
    )
    job.finish({ result })
  } catch (error) {
    job.finish({ error })
  } finally {
    if (!useDefaultCache) await rm(cachePath, { recursive: true, force: true })
  }
}

// Native tests must not share a process with Vite's module transformer. Run
// independent subprocesses in parallel instead of serialising 24 entire suites
// behind one Vitest file. Keep the expensive third-party runners serialised
// (they share PM2 home), and likewise the suites that edit common fixtures.
async function executeQueuedSuites() {
  const cacheJobs = nativeJobs.filter(({ suite }) => suite === "cache-tests.js")
  const otherJobs = nativeJobs.filter(({ suite }) => suite !== "cache-tests.js")
  const locks = new Map<string, Promise<void>>()
  let nextIndex = 0

  async function worker() {
    while (nextIndex < otherJobs.length) {
      const job = otherJobs[nextIndex++]
      const mustSerialise = job.suite === "scenario-tests.mjs" || job.suite === "misc-tests.js"
      const previous = mustSerialise ? locks.get(job.suite) : undefined
      let unlock = () => {}
      if (mustSerialise) {
        locks.set(
          job.suite,
          new Promise<void>((resolve) => {
            unlock = resolve
          })
        )
      }

      try {
        await previous
        await executeNativeSuite(job)
      } finally {
        unlock()
      }
    }
  }

  // Keep nested Node/tool processes bounded even when Vitest file parallelism
  // is enabled, so Jest, AVA, and PM2 do not overwhelm slower CI machines.
  await Promise.all(Array.from({ length: Math.min(4, otherJobs.length) }, () => worker()))

  // Cache tests temporarily move node_modules/.cache and must run alone.
  for (const job of cacheJobs) await executeNativeSuite(job)
}

let activeRuns: Promise<void> | undefined
beforeAll(() => {
  activeRuns = executeQueuedSuites()
})
afterAll(async () => {
  await activeRuns
}, 600_000)

for (const esmEnv of testEnvironments) {
  describe(`native Node integration (${esmEnv})`, () => {
    for (const suite of nativeSuites) {
      const cases = collectNativeCases(suite)
      // Scenario suites spawn PM2, Jest, AVA, and other external tools.
      const timeout = suite === "scenario-tests.mjs" ? 300_000 : 120_000
      // Cache suites run sequentially, so both environments can verify disk
      // caching without racing on the shared cache directory.
      const skipCache = suite === "cache-tests.js" && Reflect.has(process.env, "APPVEYOR")

      describe(suite, () => {
        const results = new Map<string, TestRecord>()
        const skippedSuites = new Set<string>()
        let output = ""
        let errorOutput = ""

        const result = skipCache ? undefined : queueNativeSuite(suite, esmEnv, timeout)

        if (result) {
          beforeAll(async () => {
            const outcome = await result
            if ("error" in outcome) throw outcome.error
            const { exitCode, stdout, stderr } = outcome.result

            output = stdout
            errorOutput = stderr
            const records = parseNativeRecords(stdout)
            const summary = records.find(
              (record): record is SummaryRecord => record.kind === "summary"
            )
            assert.ok(
              summary,
              `Native suite did not return a test summary:\n${diagnostic(stdout, stderr)}`
            )

            for (const record of records) {
              if (record.kind === "test") {
                const key = location(record.line, record.column)
                assert.ok(!results.has(key), `Duplicate node:test result at ${suite}:${key}`)
                results.set(key, record)
              } else if (record.kind === "skipped-suite") {
                skippedSuites.add(location(record.line, record.column))
              } else if (record.kind === "suite-failure") {
                assert.fail(`Native suite ${record.name} failed: ${record.error}`)
              }
            }

            const declarations = new Set(cases.map((testCase) => testCase.location))
            for (const key of results.keys()) {
              assert.ok(declarations.has(key), `Unexpected node:test case at ${suite}:${key}`)
            }

            for (const testCase of cases) {
              if (!results.has(testCase.location)) {
                assert.ok(
                  testCase.suites.some((key) => skippedSuites.has(key)),
                  `Native assertion missing from ${suite}: ${testCase.name} (${testCase.location})\n${diagnostic(stdout, stderr)}`
                )
              }
            }

            assert.equal(
              summary.counts.tests,
              results.size,
              `node:test result count differs in ${suite}`
            )
            assert.equal(
              summary.counts.failed,
              [...results.values()].filter((record) => record.status === "fail").length,
              `node:test failure count differs in ${suite}`
            )
            if (summary.success && exitCode !== 0) {
              assert.fail(
                `Native suite exited ${exitCode} despite passing tests:\n${diagnostic(stdout, stderr)}`
              )
            }
            if (!summary.success && summary.counts.failed === 0) {
              assert.fail(
                `Native suite failed without a failing test:\n${diagnostic(stdout, stderr)}`
              )
            }
          }, timeout + 120_000)
        }

        for (const testCase of cases) {
          it.skipIf(skipCache)(testCase.name, (context) => {
            const record = results.get(testCase.location)
            if (!record && testCase.suites.some((key) => skippedSuites.has(key))) {
              context.skip()
              return
            }

            assert.ok(record, `Missing native result for ${suite}: ${testCase.name}`)
            assert.equal(
              record.name,
              testCase.name,
              `Native assertion mismatch at ${testCase.location}`
            )
            if (record.status === "skip") {
              context.skip()
              return
            }

            assert.equal(
              record.status,
              "pass",
              `${suite}: ${testCase.name}\n${record.error || diagnostic(output, errorOutput)}`
            )
          })
        }
      })
    }
  })
}
