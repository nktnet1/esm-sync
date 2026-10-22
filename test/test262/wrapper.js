import fs from "fs-extra"
import { createRequire, registerHooks } from "node:module"
import { pathToFileURL } from "node:url"
import path from "path"
import vm from "vm"
const requireHelper = createRequire(import.meta.url)
const { checkModuleLink, parseTest } = requireHelper("./phase-analysis.cjs")

const MAX_WAIT = 1000
const [,, testFilename, isAsync, extraIncludes = "[]", isModule = "true", expectedPhase = ""] = process.argv

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
const completion = isAsync === "true"
  ? new Promise((resolve, reject) => {
    complete = resolve
    fail = reject
    waitTimer = setTimeout(() => reject(new Error("test262: async test timed out.")), MAX_WAIT)
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
  if (isModule === "true") return import(testFilename)

  const filename = path.resolve(testFilename)
  const source = fs.readFileSync(filename, "utf8")
  const script = new vm.Script(source, {
    filename,
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER
  })
  // Script completion values do not become awaited module evaluation results.
  script.runInThisContext()
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
  let phase = "runtime"

  try {
    if (expectedPhase) {
      try {
        parseTest(path.resolve(testFilename), isModule === "true")
      } catch (failure) {
        reportFailure(failure, "parse")
        return
      }

      if (expectedPhase === "parse") return

      if (isModule === "true") {
        const linkResult = await checkModuleLink(path.resolve(testFilename))
        phase = linkResult.phase
        if (phase === "unknown") {
          throw new Error(`Cannot verify Test262 module error phase: ${linkResult.error?.message}`)
        }
      }
    }

    // Attach both handlers immediately; an async test may invoke $DONE during
    // evaluation, before its import() promise settles.
    if (completion !== null) {
      await Promise.all([Promise.resolve().then(runTest), completion])
    } else {
      await runTest()
    }
  } catch (failure) {
    reportFailure(failure, phase)
  } finally {
    clearTimeout(waitTimer)
    clearImmediate(settleTimer)
  }
}

main().catch((failure) => error("Test262 runner failed:", failure))
