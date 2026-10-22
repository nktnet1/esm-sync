import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import execa from "execa"
import { describe, it } from "vitest"
import { testPath } from "./helpers/run-node.mts"

const require = createRequire(import.meta.url)
const { assertTest262Outcome } = require("../../script/test262-outcome.js") as {
  assertTest262Outcome: (
    filename: string,
    stdout: string,
    expectedError?: string,
    expectedPhase?: string
  ) => void
}

const wrapperDirectory = path.join(testPath, "test262")
const wrapperFile = path.join(wrapperDirectory, "wrapper.js")

type TestCaseOptions = {
  source: string
  isModule?: boolean
  isAsync?: boolean
  expectedPhase?: string
  dependency?: string
}

async function executeCase(options: TestCaseOptions) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-test262-phases-"))
  try {
    const isModule = options.isModule ?? false
    const filename = path.join(directory, isModule ? "case.mjs" : "case.js")
    await writeFile(filename, options.source)
    if (options.dependency !== undefined) {
      await writeFile(path.join(directory, "dependency.mjs"), options.dependency)
    }

    const { exitCode, stderr, stdout, timedOut } = await execa(
      process.execPath,
      [
        "--harmony",
        "--experimental-vm-modules",
        "--disable-warning=ExperimentalWarning",
        "-r",
        "../../",
        wrapperFile,
        filename,
        String(options.isAsync ?? false),
        "[]",
        String(isModule),
        options.expectedPhase ?? ""
      ],
      {
        cwd: wrapperDirectory,
        env: {
          ...process.env,
          NODE_ENV: "development",
          ESM_ENV: "development-test",
          ESM_OPTIONS: isModule ? "{cjs:false,cache:false,mode:'all'}" : "{cjs:false,cache:false}"
        },
        reject: false,
        timeout: 10_000
      }
    )

    assert.equal(timedOut, false)
    assert.equal(exitCode, 0, stderr || stdout)
    assert.equal(stderr, "")
    return { filename, stdout }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

function assertFailure(result: { filename: string; stdout: string }, name: string, phase: string) {
  assertTest262Outcome(result.filename, result.stdout, name, phase)
}

describe("Test262 negative-phase verification", () => {
  it("parses negative scripts without running their bodies", async () => {
    const parse = await executeCase({ source: "const = 1", expectedPhase: "parse" })
    assertFailure(parse, "SyntaxError", "parse")

    const runtime = await executeCase({
      source: 'throw new SyntaxError("runtime")',
      expectedPhase: "parse"
    })
    assert.equal(runtime.stdout, "")
    assert.throws(
      () => assertTest262Outcome(runtime.filename, runtime.stdout, "SyntaxError", "parse"),
      /but no error occurred/
    )
  })

  it("parses negative modules using the esm-sync compiler rather than evaluating them", async () => {
    const result = await executeCase({
      source:
        'import { named } from "./dependency.mjs"; export const = 1; throw new Error("evaluated")',
      isModule: true,
      expectedPhase: "parse"
    })
    assertFailure(result, "SyntaxError", "parse")
  })

  it("distinguishes missing exports during linking from a runtime SyntaxError", async () => {
    const missing = await executeCase({
      source: 'import { missing } from "./dependency.mjs"; $DONOTEVALUATE()',
      dependency: "export const present = 1",
      isModule: true,
      expectedPhase: "resolution"
    })
    assertFailure(missing, "SyntaxError", "resolution")
    assert.throws(
      () => assertTest262Outcome(missing.filename, missing.stdout, "SyntaxError", "runtime"),
      /unexpected error phase/
    )

    const thrown = await executeCase({
      source: 'import "./dependency.mjs";',
      dependency: 'throw new SyntaxError("evaluation failed")',
      isModule: true,
      expectedPhase: "resolution"
    })
    assertFailure(thrown, "SyntaxError", "runtime")
    assert.throws(
      () => assertTest262Outcome(thrown.filename, thrown.stdout, "SyntaxError", "resolution"),
      /unexpected error phase/
    )
  })

  it("accepts a runtime error only with the correct type and phase", async () => {
    const failure = await executeCase({
      source: 'throw new TypeError("wrong")',
      expectedPhase: "runtime"
    })
    assertFailure(failure, "TypeError", "runtime")
    assert.throws(
      () => assertTest262Outcome(failure.filename, failure.stdout, "SyntaxError", "runtime"),
      /unexpected error type/
    )
  })
})

describe("Test262 asynchronous completion", () => {
  it("does not confuse ordinary print output with $DONE", async () => {
    const result = await executeCase({
      source: 'print("Test262:AsyncTestComplete")',
      isAsync: true
    })
    assertFailure(result, "Error", "runtime")
    assert.match(result.stdout, /timed out/)
  })

  it("completes on $DONE and preserves its original error", async () => {
    const completed = await executeCase({
      source: "Promise.resolve().then(() => $DONE())",
      isAsync: true
    })
    assert.equal(completed.stdout, "")

    const failed = await executeCase({
      source: 'Promise.resolve().then(() => $DONE(new TypeError("async failure")))',
      isAsync: true
    })
    assertFailure(failed, "TypeError", "runtime")
    assert.match(failed.stdout, /async failure/)
  })

  it("rejects duplicate $DONE calls and uncaught rejections", async () => {
    const duplicate = await executeCase({
      source: "$DONE(); $DONE()",
      isAsync: true
    })
    assertFailure(duplicate, "Error", "runtime")
    assert.match(duplicate.stdout, /more than once/)

    const rejection = await executeCase({
      source: 'Promise.reject(new RangeError("unhandled"))',
      isAsync: true
    })
    assertFailure(rejection, "RangeError", "runtime")
  })
})
