import fs from "fs-extra"
import { createRequire, registerHooks } from "node:module"
import { pathToFileURL } from "node:url"
import path from "path"
import vm from "vm"
const requireHelper = createRequire(import.meta.url)
const { checkModuleLink, getCompiler, getModuleLoader, parseTest, runModule, runScript } = requireHelper("./phase-analysis.cjs")

const DEFAULT_ASYNC_TEST_TIMEOUT_MS = 10_000
const [,, testFilename, isAsync, extraIncludes = "[]", isModule = "true", expectedPhase = "", syntaxOnly = "false", asyncTimeoutOverride] = process.argv
// The optional per-case deadline lets watchdog tests finish quickly without
// reducing the default budget for genuine asynchronous conformance cases.
const asyncTestTimeoutMs = asyncTimeoutOverride === undefined
  ? DEFAULT_ASYNC_TEST_TIMEOUT_MS
  : Number(asyncTimeoutOverride)
if (!Number.isSafeInteger(asyncTestTimeoutMs) || asyncTestTimeoutMs <= 0) {
  throw new RangeError("Test262 async timeout must be a positive integer")
}

const testPath = path.resolve("../vendor/test262")
const harnessPath = path.resolve(testPath, "harness")
const fixtureDirectory = path.join(fs.realpathSync(testPath), "test/language") + path.sep
const moduleFixturePrefix = pathToFileURL(fixtureDirectory).href

// Test262 *_FIXTURE.js imports are modules even when they have no ESM syntax.
// Native dynamic import would otherwise give empty fixtures a CommonJS default
// export. Keep this hook confined to the pinned corpus, not application code.
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)
    if (
      url.startsWith(moduleFixturePrefix) &&
      /_FIXTURE\.js(?:[?#]|$)/.test(url) &&
      context.importAttributes?.type === undefined
    ) {
      return { ...loaded, format: "module" }
    }
    return loaded
  }
})

const harnessFilenames = new Set([
  "assert.js",
  "compareArray.js",
  "doneprintHandle.js",
  "fnGlobalObject.js",
  "sta.js",
  ...JSON.parse(extraIncludes)
])

// The Test262 harness provides print() but Test262's completion signal is
// $DONE(), not arbitrary output. Regular print calls must not finish a test.
global.print = () => {}

for (const filename of harnessFilenames) {
  if (path.basename(filename) !== filename) {
    throw new Error(`Invalid Test262 harness include: ${filename}`)
  }

  const includePath = path.resolve(harnessPath, filename)
  vm.runInThisContext(fs.readFileSync(includePath, "utf-8"), { filename: includePath })
}

// Suppress logging from the test without losing its errors.
const { error, log } = console
const noop = () => {}
for (const name of Object.keys(console)) {
  if (typeof console[name] === "function") console[name] = noop
}

let complete
let fail
let completed = 0
let waitTimer
let settleTimer
class Test262HarnessTimeout extends Error {}

const completion = isAsync === "true"
  ? new Promise((resolve, reject) => {
    complete = resolve
    fail = reject
  })
  : null

// A completion failure and an uncaught rejected promise are observable test
// failures, never warnings to swallow. A successful $DONE is deferred by one
// turn so duplicate same-turn completions are detected.
global.$DONE = (failure) => {
  if (completion === null) {
    throw new Error("Test262: $DONE called without the async flag")
  }
  if (++completed !== 1) {
    clearImmediate(settleTimer)
    fail(new Error("Test262: $DONE called more than once"))
  } else if (failure !== undefined) {
    fail(failure)
  } else {
    settleTimer = setImmediate(complete)
  }
}

if (completion !== null) {
  process.on("unhandledRejection", fail)
  process.on("uncaughtException", fail)
}

function runTest() {
  if (isModule === "true") return runModule(path.resolve(testFilename))

  // Script-goal execution remains native vm.Script, with esm-sync compiling
  // phase-qualified dynamic imports where Node's parser cannot handle them.
  // Completion values are not awaited as module evaluation results.
  runScript(path.resolve(testFilename), isAsync !== "true" && !expectedPhase)
}

function reportFailure(failure, phase) {
  let name = ""
  let message = ""

  if (failure !== null && (typeof failure === "object" || typeof failure === "function")) {
    name = String(failure.name || failure.constructor?.name || "")
    message = failure.message === undefined ? "" : String(failure.message)
  } else {
    name = "Test262Error"
    message = String(failure)
  }

  log(JSON.stringify({ name, message, phase }))
}

async function main() {
  const needsParsing = Boolean(expectedPhase) || syntaxOnly === "true" || isModule === "true"

  // Compiler/linker bootstrap errors are runner failures, not Test262 error
  // phases. Initialise outside the test-error handler to prevent false passes.
  if (needsParsing) getCompiler()
  if (isModule === "true" && expectedPhase !== "parse" && syntaxOnly !== "true") {
    getModuleLoader()
  }

  const phase = "runtime"

  try {
    if (needsParsing) {
      try {
        parseTest(path.resolve(testFilename), isModule === "true")
      } catch (failure) {
        reportFailure(failure, "parse")
        return
      }

      // Generated grammar-only cases must not resolve placeholder imports.
      // Like parse negatives, they verify syntax without executing the body.
      if (expectedPhase === "parse" || syntaxOnly === "true") return

      if (isModule === "true") {
        const linkResult = checkModuleLink(path.resolve(testFilename))
        if (!linkResult.linked) {
          reportFailure(linkResult.error, linkResult.phase)
          return
        }

        // A successful instantiation is not a resolution-negative pass,
        // regardless of what evaluating the body might later throw.
        if (expectedPhase === "resolution") return
      }
    }

    // Attach both handlers immediately; an async test may invoke $DONE during
    // evaluation, before its import() promise settles.
    if (completion !== null) {
      // Time only the execution/completion phase, not harness startup or linking.
      // A one-second deadline is too sensitive to CI contention, especially on macOS.
      waitTimer = setTimeout(
        () => fail(new Test262HarnessTimeout(`Test262: $DONE() was not called within ${asyncTestTimeoutMs} ms`)),
        asyncTestTimeoutMs
      )
      await Promise.all([Promise.resolve().then(runTest), completion])
    } else {
      await runTest()
    }
  } catch (failure) {
    // Harness timeouts are infrastructure failures, never expected JS errors.
    // In particular, an expected runtime Error must not mask a missing $DONE().
    if (failure instanceof Test262HarnessTimeout) throw failure
    reportFailure(failure, phase)
  } finally {
    clearTimeout(waitTimer)
    clearImmediate(settleTimer)
  }
}

main().catch((failure) => {
  process.exitCode = 1
  error("Test262 runner failed:", failure)
})
