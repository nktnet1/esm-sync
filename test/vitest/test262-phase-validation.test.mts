import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
  moduleFilename?: string
  isAsync?: boolean
  expectedPhase?: string
  syntaxOnly?: boolean
  dependency?: string
  dependencies?: Record<string, string>
}

async function executeCase(options: TestCaseOptions) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-test262-phases-"))
  try {
    const isModule = options.isModule ?? false
    const filename = path.join(
      directory,
      options.moduleFilename ?? (isModule ? "case.mjs" : "case.js")
    )
    await writeFile(filename, options.source)
    if (options.dependency !== undefined) {
      await writeFile(path.join(directory, "dependency.mjs"), options.dependency)
    }
    for (const [name, source] of Object.entries(options.dependencies ?? {})) {
      await writeFile(path.join(directory, name), source)
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
        options.expectedPhase ?? "",
        String(options.syntaxOnly ?? false)
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

  it("uses esm-sync script grammar for invalid source-phase constructor calls", async () => {
    const invalid = await executeCase({
      source: "new import.source('./dependency.mjs').prop;",
      expectedPhase: "parse"
    })
    assertFailure(invalid, "SyntaxError", "parse")

    // Script-specific duplicate var/function declarations are legal.
    const valid = await executeCase({
      source: "var smoosh; function smoosh() {}",
      syntaxOnly: true
    })
    assert.equal(valid.stdout, "")
  })

  it("parses generated positive grammar cases without resolving placeholder imports", async () => {
    const valid = await executeCase({
      source: "var smoosh; function smoosh() {} import.source('<module source>');",
      syntaxOnly: true
    })
    assert.equal(valid.stdout, "")

    const invalid = await executeCase({
      source: "new import.source('<module source>').prop;",
      syntaxOnly: true
    })
    assertFailure(invalid, "SyntaxError", "parse")

    // Syntax-only mode is opt-in, so ordinary script assertions still run.
    const runtime = await executeCase({ source: "throw new RangeError('evaluated')" })
    assertFailure(runtime, "RangeError", "runtime")
  })

  it("passes the pinned top-level import.source syntax cases", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-test262-report-"))
    try {
      const command = path.join(testPath, "../script/run-test262.js")
      const reportFile = path.join(directory, "report.json")
      const { exitCode, stderr, stdout, timedOut } = await execa(
        process.execPath,
        [
          command,
          "--filter",
          "top-level-import-source",
          "--reporter",
          "dot",
          "--report",
          reportFile
        ],
        {
          cwd: path.dirname(command),
          reject: false,
          timeout: 20_000,
          env: { ...process.env, NODE_ENV: "development", ESM_ENV: "development-test" }
        }
      )
      assert.equal(timedOut, false)
      assert.equal(exitCode, 0, stderr || stdout)

      const report = JSON.parse(await readFile(reportFile, "utf8")) as {
        selected: number
        passed: number
        failed: number
        cases: Array<{ path: string; syntaxOnly?: boolean }>
      }
      assert.equal(report.selected, 6)
      assert.equal(report.passed, 6)
      assert.equal(report.failed, 0)
      assert.deepEqual(
        report.cases
          .filter(({ syntaxOnly }) => syntaxOnly)
          .map(({ path: filename }) => path.basename(filename))
          .sort(),
        [
          "top-level-import-source-empty-str-is-valid-assign-expr.js",
          "top-level-import-source-script-code-valid.js"
        ]
      )
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
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
      expectedPhase: "runtime"
    })
    assertFailure(thrown, "SyntaxError", "runtime")
    assert.throws(
      () => assertTest262Outcome(thrown.filename, thrown.stdout, "SyntaxError", "resolution"),
      /unexpected error phase/
    )
  })

  it("attributes syntax errors in dependencies to the resolution phase", async () => {
    const result = await executeCase({
      source: 'import "./dependency.mjs"; throw new Error("root evaluated")',
      dependency: "export const = 1",
      isModule: true,
      expectedPhase: "resolution"
    })
    assertFailure(result, "SyntaxError", "resolution")
    assert.throws(
      () => assertTest262Outcome(result.filename, result.stdout, "SyntaxError", "parse"),
      /unexpected error phase/
    )
  })

  it("checks positive module linking before allowing evaluation", async () => {
    const invalid = await executeCase({
      source: 'import { absent } from "./dependency.mjs"; throw new SyntaxError("evaluated")',
      dependency: "export const present = 1",
      isModule: true
    })
    assertFailure(invalid, "SyntaxError", "resolution")
    assert.match(invalid.stdout, /absent/)
    assert.doesNotMatch(invalid.stdout, /evaluated/)

    const evaluated = await executeCase({
      source: 'throw new TypeError("positive module evaluated")',
      isModule: true
    })
    assertFailure(evaluated, "TypeError", "runtime")

    const valid = await executeCase({
      source:
        'import { answer } from "./dependency.mjs"; if (answer !== 42) throw new Error("bad import")',
      dependency: "export const answer = 42",
      isModule: true
    })
    assert.equal(valid.stdout, "")
  })

  it("instantiates a valid module graph without executing any of its bodies", async () => {
    const result = await executeCase({
      source: 'import { value } from "./dependency.mjs"; throw new SyntaxError("root evaluated")',
      dependency: 'export const value = 1; throw new SyntaxError("dependency evaluated")',
      isModule: true,
      expectedPhase: "resolution"
    })
    assert.equal(result.stdout, "")
    assert.throws(
      () => assertTest262Outcome(result.filename, result.stdout, "SyntaxError", "resolution"),
      /but no error occurred/
    )
  })

  it("does not evaluate a syntax-free module while checking instantiation", async () => {
    const result = await executeCase({
      source: 'throw new SyntaxError("the body is not a linker error")',
      isModule: true,
      expectedPhase: "resolution"
    })
    assert.equal(result.stdout, "")
  })

  it("enforces the Test262 module goal for syntax-free .js files", async () => {
    const result = await executeCase({
      source: 'if (this !== undefined) throw new SyntaxError("executed as CommonJS")',
      moduleFilename: "case.js",
      isModule: true
    })
    assert.equal(result.stdout, "")
  })

  it("validates cyclic imports through esm-sync without evaluating the cycle", async () => {
    const result = await executeCase({
      source: 'import { first } from "./a.mjs"; throw new TypeError("root evaluated")',
      dependencies: {
        "a.mjs":
          'import { second } from "./b.mjs"; export const first = 1; throw new Error("a evaluated")',
        "b.mjs":
          'import { first } from "./a.mjs"; export const second = 2; throw new Error("b evaluated")'
      },
      isModule: true,
      expectedPhase: "resolution"
    })
    assert.equal(result.stdout, "")
  })

  it("rejects missing exports in a transitive graph before evaluating bodies", async () => {
    const result = await executeCase({
      source: 'import "./bridge.mjs"; throw new SyntaxError("root evaluated")',
      dependencies: {
        "bridge.mjs":
          'import { absent } from "./leaf.mjs"; throw new SyntaxError("bridge evaluated")',
        "leaf.mjs": 'export const present = 1; throw new SyntaxError("leaf evaluated")'
      },
      isModule: true,
      expectedPhase: "resolution"
    })
    assertFailure(result, "SyntaxError", "resolution")
    assert.match(result.stdout, /absent/)
    assert.doesNotMatch(result.stdout, /evaluated/)
  })

  it("rejects an ambiguous star re-export during instantiation", async () => {
    const result = await executeCase({
      source: 'import { shared } from "./barrel.mjs"; throw new SyntaxError("root evaluated")',
      dependencies: {
        "barrel.mjs": 'export * from "./left.mjs"; export * from "./right.mjs"',
        "left.mjs": 'export const shared = 1; throw new Error("left evaluated")',
        "right.mjs": 'export const shared = 2; throw new Error("right evaluated")'
      },
      isModule: true,
      expectedPhase: "resolution"
    })
    assertFailure(result, "SyntaxError", "resolution")
    assert.match(result.stdout, /shared/)
    assert.doesNotMatch(result.stdout, /evaluated/)
  })

  it("does not credit a matching runtime error to the resolution phase", async () => {
    const result = await executeCase({
      source: 'import "./dependency.mjs"; throw new SyntaxError("root runtime failure")',
      dependency: 'throw new SyntaxError("dependency runtime failure")',
      isModule: true,
      expectedPhase: "resolution"
    })
    assert.equal(result.stdout, "")
    assert.throws(
      () => assertTest262Outcome(result.filename, result.stdout, "SyntaxError", "resolution"),
      /but no error occurred/
    )
  })

  it("links deferred imports without triggering evaluation", async () => {
    const linked = await executeCase({
      source:
        'import defer * as ns from "./dependency.mjs"; throw new SyntaxError("root evaluated")',
      dependency: 'export const value = 1; throw new SyntaxError("deferred evaluated")',
      isModule: true,
      expectedPhase: "resolution"
    })
    assert.equal(linked.stdout, "")

    const runtime = await executeCase({
      source:
        'import defer * as ns from "./dependency.mjs"; if (ns.value !== 1) throw new Error("wrong value")',
      dependency: "export const value = 1",
      isModule: true
    })
    assert.equal(runtime.stdout, "")
  })

  it("classifies actual dependency evaluation failures as runtime errors", async () => {
    const result = await executeCase({
      source: 'import "./dependency.mjs"',
      dependency: 'throw new SyntaxError("dependency runtime failure")',
      isModule: true,
      expectedPhase: "runtime"
    })
    assertFailure(result, "SyntaxError", "runtime")
    assert.match(result.stdout, /dependency runtime failure/)
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
