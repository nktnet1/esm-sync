import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises"
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
  packageType?: "commonjs" | "module"
  isAsync?: boolean
  expectedPhase?: string
  syntaxOnly?: boolean
  dependency?: string
  dependencies?: Record<string, string>
  symlinkedDirectory?: boolean
}

async function executeCase(options: TestCaseOptions) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-test262-phases-"))
  const aliasDirectory = `${directory}-alias`
  let createdAlias = false
  try {
    const isModule = options.isModule ?? false
    const relativeFilename = options.moduleFilename ?? (isModule ? "case.mjs" : "case.js")
    const filename = path.join(directory, relativeFilename)
    await writeFile(filename, options.source)
    if (options.packageType) {
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({ type: options.packageType })
      )
    }
    if (options.dependency !== undefined) {
      await writeFile(path.join(directory, "dependency.mjs"), options.dependency)
    }
    for (const [name, source] of Object.entries(options.dependencies ?? {})) {
      await writeFile(path.join(directory, name), source)
    }

    if (options.symlinkedDirectory) {
      await symlink(directory, aliasDirectory, "junction")
      createdAlias = true
    }
    const testFilename = options.symlinkedDirectory
      ? path.join(aliasDirectory, relativeFilename)
      : filename

    const { exitCode, stderr, stdout, timedOut } = await execa(
      process.execPath,
      [
        "--harmony",
        "--experimental-vm-modules",
        "--disable-warning=ExperimentalWarning",
        "-r",
        "../../",
        wrapperFile,
        testFilename,
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
    return { filename: testFilename, stdout }
  } finally {
    if (createdAlias) await unlink(aliasDirectory)
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

  it("runs assertions in generated syntax-valid cases instead of marking them parse-only", async () => {
    // Unlike an unobserved import(''), this generated template checks the
    // returned Promise in a `with` expression. Its body must actually run.
    const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-test262-execution-"))
    try {
      const command = path.join(testPath, "../script/run-test262.js")
      const reportFile = path.join(directory, "report.json")
      const { exitCode, stderr, stdout, timedOut } = await execa(
        process.execPath,
        [
          command,
          "--filter",
          "nested-with-expression-import-attributes-trailing-comma-first.js",
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
        cases: Array<{ path: string; syntaxOnly?: boolean; status: string }>
      }
      assert.equal(report.selected, 1)
      assert.equal(report.passed, 1)
      assert.equal(report.failed, 0)
      assert.equal(report.cases[0].syntaxOnly, undefined)
      assert.equal(report.cases[0].status, "pass")
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

  it("reports module early errors during parsing without linking or evaluating", async () => {
    const invalidSources = [
      "let duplicate; let duplicate;",
      "let conflict; var conflict;",
      "outer: outer: while (false) break outer;",
      "continue undefinedLabel;",
      "var implements = 1;",
      "void target.#undeclared;",
      'import { value as eval } from "./missing.mjs";'
    ]

    for (const source of invalidSources) {
      const result = await executeCase({
        source: `${source}\nthrow new Error("evaluated")`,
        isModule: true,
        expectedPhase: "parse"
      })
      assertFailure(result, "SyntaxError", "parse")
    }
  })

  it("accepts valid module syntax without resolving imports or running module bodies", async () => {
    const validSources = [
      "let left; let right;",
      "outer: while (true) break outer;",
      "class Valid { #value = 1; read() { return this.#value } }",
      'import { value as local } from "./missing.mjs";',
      'import defer * as namespace from "./missing.mjs";',
      'import.source("./missing.mjs");'
    ]

    for (const source of validSources) {
      const result = await executeCase({
        source: `${source}\nthrow new Error("evaluated")`,
        isModule: true,
        syntaxOnly: true
      })
      assert.equal(result.stdout, "")
    }
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
      source:
        'if (this !== undefined || typeof require !== "undefined" || typeof module !== "undefined") throw new SyntaxError("executed as CommonJS")',
      moduleFilename: "case.js",
      packageType: "commonjs",
      isModule: true
    })
    assert.equal(result.stdout, "")
  })

  it("uses the module goal for syntax-free .js dependencies", async () => {
    const result = await executeCase({
      source:
        'import "./dependency.js"; if (this !== undefined) throw new SyntaxError("root was CommonJS")',
      dependencies: {
        "dependency.js": 'if (this !== undefined) throw new SyntaxError("dependency was CommonJS")'
      },
      moduleFilename: "case.js",
      packageType: "commonjs",
      isModule: true
    })
    assert.equal(result.stdout, "")
  })

  it("checks the resolution of syntax-free .js modules without running their bodies", async () => {
    const result = await executeCase({
      source: 'throw new SyntaxError("evaluated instead of linked")',
      moduleFilename: "case.js",
      packageType: "commonjs",
      isModule: true,
      expectedPhase: "resolution"
    })
    assert.equal(result.stdout, "")
  })

  it("preserves module goals and link-only checks through symlinked fixture paths", async () => {
    const options = {
      isModule: true,
      moduleFilename: "case.js",
      packageType: "commonjs" as const,
      symlinkedDirectory: true
    }

    const root = await executeCase({
      ...options,
      source:
        'if (this !== undefined || typeof require !== "undefined" || typeof module !== "undefined") throw new SyntaxError("executed as CommonJS")'
    })
    assert.equal(root.stdout, "")

    const dependency = await executeCase({
      ...options,
      source:
        'import "./dependency.js"; if (this !== undefined) throw new SyntaxError("root was CommonJS")',
      dependencies: {
        "dependency.js": 'if (this !== undefined) throw new SyntaxError("dependency was CommonJS")'
      }
    })
    assert.equal(dependency.stdout, "")

    const resolution = await executeCase({
      ...options,
      source: 'throw new SyntaxError("evaluated instead of linked")',
      expectedPhase: "resolution"
    })
    assert.equal(resolution.stdout, "")
  })

  it("links syntax-free .js dependencies without executing them", async () => {
    const result = await executeCase({
      source: 'import "./dependency.js"; throw new SyntaxError("root evaluated")',
      dependencies: {
        "dependency.js": 'throw new SyntaxError("dependency evaluated during linking")'
      },
      moduleFilename: "case.js",
      packageType: "commonjs",
      isModule: true,
      expectedPhase: "resolution"
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

  it("reuses deferred namespace identity across static and dynamic imports without top-level await", async () => {
    const result = await executeCase({
      source: `
import * as eager from "./dependency.mjs";
import defer * as first from "./dependency.mjs";
import defer * as second from "./dependency.mjs";
import { fromBridge } from "./bridge.mjs";
assert.sameValue(first, second, "repeated static imports share a deferred namespace");
assert.sameValue(first, fromBridge, "different importers share a deferred namespace");
assert.notSameValue(first, eager, "deferred and eager namespaces are distinct");
import.defer("./dependency.mjs")
  .then((dynamic) => {
    assert.sameValue(first, dynamic, "static and dynamic deferred namespaces are identical");
    assert.sameValue(dynamic.value, 42);
  })
  .then($DONE, $DONE);`,
      dependencies: {
        "dependency.mjs": "export const value = 42;",
        "bridge.mjs": 'import defer * as ns from "./dependency.mjs"; export const fromBridge = ns;'
      },
      isModule: true,
      isAsync: true
    })
    assert.equal(result.stdout, "")
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

describe("Test262 script-goal deferred imports", () => {
  it("preserves script globals and exact rejection identity across microtasks", async () => {
    const result = await executeCase({
      source: `
if (this !== globalThis || typeof module !== "undefined") throw new Error("not a script");
var test262GlobalFromScript = 17;
if (globalThis.test262GlobalFromScript !== 17) throw new Error("no script global");
const reason = new Test262Error("toString failed");
const specifier = { toString() { throw reason; } };
Promise.resolve()
  .then(() => import.defer(specifier))
  .then(
    () => $DONE(new Error("deferred import unexpectedly resolved")),
    (error) => $DONE(error === reason ? undefined : new Error("rejection identity changed"))
  );`,
      isAsync: true
    })
    assert.equal(result.stdout, "")
  })

  it("links but defers a real dependency until its namespace is read", async () => {
    const result = await executeCase({
      source: `
var test262EvaluationCount = 0;
import.defer("./dependency.mjs")
  .then((namespace) => {
    if (globalThis.test262EvaluationCount !== 0) throw new Error("evaluated eagerly");
    if (namespace.answer !== 42) throw new Error("incorrect deferred export");
    if (globalThis.test262EvaluationCount !== 1) throw new Error("evaluation not deferred");
  })
  .then($DONE, $DONE);`,
      dependency: "globalThis.test262EvaluationCount += 1; export const answer = 42;",
      isAsync: true
    })
    assert.equal(result.stdout, "")
  })

  it("does not transform scripts that mention import.defer only in strings", async () => {
    const result = await executeCase({
      source: `
var description = "import.defer(";
if (this !== globalThis || description !== "import.defer(") throw new Error("script changed");
if (globalThis.description !== description) throw new Error("script global changed");`
    })
    assert.equal(result.stdout, "")
  })

  it("runs all pinned script-goal import.defer specifier rejection cases", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-test262-defer-rejections-"))
    try {
      const runner = path.resolve(testPath, "../script/run-test262.js")
      const reportPath = path.join(directory, "report.json")
      const { exitCode, stdout, stderr, timedOut } = await execa(
        process.execPath,
        [
          runner,
          "--filter",
          "import-defer-specifier-tostring-abrupt-rejects",
          "--reporter",
          "dot",
          "--report",
          reportPath
        ],
        { cwd: path.dirname(runner), reject: false, timeout: 30_000 }
      )
      assert.equal(timedOut, false)
      assert.equal(exitCode, 0, stderr || stdout)
      const report = JSON.parse(await readFile(reportPath, "utf8")) as {
        selected: number
        passed: number
        failed: number
        unsupported: number
        complete: boolean
        cases: Array<{ status: string; expectedError: string | null; path: string }>
      }
      assert.equal(report.complete, true)
      assert.equal(report.selected, 16)
      assert.equal(report.passed, 16)
      assert.equal(report.failed, 0)
      assert.equal(report.unsupported, 0)
      assert.ok(
        report.cases.every(
          ({ status, path: filename, expectedError }) =>
            status === "pass" &&
            expectedError === null &&
            filename.includes("/dynamic-import/catch/")
        )
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
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
