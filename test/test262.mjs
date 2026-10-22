import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { after, describe, it } from "node:test"
import execa from "execa"
import globby from "globby"
import test262Parser from "test262-parser"

const require = createRequire(import.meta.url)
const setupTest262 = require("../script/setup-test262.js")
const {
  createReport,
  detectHostFeatures,
  getUnsupportedFeatures,
  selectCases
} = require("../script/test262-selection.js")
const testPath = fileURLToPath(new URL("./", import.meta.url))
const fixturePath = path.join(testPath, "test262")
const corpusPath = path.join(testPath, "vendor/test262")
const wrapperPath = path.join(fixturePath, "wrapper.js")
const skiplistPath = path.join(fixturePath, "skiplist")

if (!setupTest262.isPrepared()) {
  throw new Error("The pinned Test262 corpus is missing or outdated. Run `pnpm fixtures:test262` first.")
}

function readSkiplist(filename) {
  const entries = new Map()
  const content = readFileSync(filename, "utf8")
  const entryPattern = /^(#.*)\r?\n([^#\r\n].*)/gm

  for (const match of content.matchAll(entryPattern)) {
    const reason = match[1].slice(1).trim()
    const testFile = path.resolve(corpusPath, match[2].trim())
    entries.set(testFile, reason)
  }

  return entries
}

function readCase(filename) {
  const { attrs } = test262Parser.parseFile(readFileSync(filename, "utf8"))
  return {
    description: attrs.description?.trim() || path.basename(filename),
    expectedError: attrs.negative?.type,
    expectedPhase: attrs.negative?.phase,
    isAsync: Boolean(attrs.flags.async),
    isModule: Boolean(attrs.flags.module),
    features: attrs.features || [],
    includes: attrs.includes || []
  }
}

async function runCase(filename, { expectedError, isAsync, isModule, includes }) {
  const { exitCode, stdout, stderr, timedOut } = await execa(
    process.execPath,
    ["--harmony", "-r", "../../", wrapperPath, filename, String(isAsync), JSON.stringify(includes), String(isModule)],
    {
      cwd: fixturePath,
      reject: false,
      timeout: 20_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        ESM_ENV: "development-test",
        // Test262 marks modules explicitly, even when they have no import/export syntax.
        ESM_OPTIONS: isModule ? "{cjs:false,cache:false,mode:'all'}" : "{cjs:false,cache:false}"
      }
    }
  )

  assert.ok(!timedOut, `Test262 subprocess timed out: ${filename}`)
  assert.equal(exitCode, 0, `${filename}: ${stderr || stdout}`)
  assert.equal(stderr, "", `${filename}: unexpected stderr`)

  if (stdout.trim()) {
    const { name } = JSON.parse(stdout)
    assert.ok(typeof name === "string" && name.length > 0, `${filename}: invalid error report`)
    assert.equal(name, expectedError, `${filename}: unexpected error type`)
  } else {
    assert.equal(expectedError, undefined, `${filename}: expected ${expectedError}, but no error occurred`)
  }
}

const skiplist = readSkiplist(skiplistPath)
const files = globby
  .sync(["test/language/**/*.js", "!**/*_FIXTURE.js"], {
    absolute: true,
    cwd: corpusPath
  })
  .sort()

if (files.length === 0) {
  throw new Error("No Test262 cases found in the pinned corpus")
}

const hostFeatures = detectHostFeatures()
const cases = files.map((filename) => {
  const metadata = readCase(filename)
  return {
    filename,
    relativePath: path.relative(corpusPath, filename).split(path.sep).join("/"),
    skippedReason: skiplist.get(path.normalize(filename)),
    unsupportedFeatures: getUnsupportedFeatures(metadata.features, hostFeatures),
    ...metadata
  }
})
const excluded = cases.filter(({ skippedReason }) => skippedReason !== undefined)
const filter = process.env.TEST262_FILTER || ""
const limitValue = process.env.TEST262_LIMIT
const limit = limitValue ? Number(limitValue) : undefined
const selectedCases = selectCases(cases, { filter, limit })
const unsupportedCases = selectedCases.filter(({ unsupportedFeatures }) => unsupportedFeatures.length > 0)
const reportPath = process.env.TEST262_REPORT
const results = []

if (excluded.length > 0) {
  console.info(`Test262: excluding ${excluded.length} known cases from test/test262/skiplist`)
}

console.info(
  `Test262: selected ${selectedCases.length} of ${cases.length - excluded.length} non-excluded cases (${selectedCases.length - unsupportedCases.length} runnable, ${unsupportedCases.length} unsupported)`
)

describe(`Test262 conformance (${setupTest262.revision})`, { concurrency: 4 }, () => {
  if (reportPath) {
    after(() => {
      const report = createReport({
        revision: setupTest262.revision,
        selected: selectedCases.length,
        excluded: excluded.length,
        results
      })
      const outputPath = path.resolve(reportPath)
      mkdirSync(path.dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
      console.info(`Test262: wrote report to ${outputPath}`)
    })
  }

  for (const testCase of selectedCases) {
    const title = `${testCase.description} (${testCase.relativePath})`
    const result = {
      path: testCase.relativePath,
      description: testCase.description,
      expectedError: testCase.expectedError ?? null,
      expectedPhase: testCase.expectedPhase ?? null
    }

    if (testCase.unsupportedFeatures.length > 0) {
      results.push({
        ...result,
        status: "unsupported",
        unsupportedFeatures: testCase.unsupportedFeatures
      })
      it.skip(title, { skip: `Unsupported host features: ${testCase.unsupportedFeatures.join(", ")}` }, () => {})
      continue
    }

    it(title, async () => {
      try {
        await runCase(testCase.filename, testCase)
        results.push({ ...result, status: "pass" })
      } catch (error) {
        results.push({
          ...result,
          status: "fail",
          error: {
            name: error?.name ?? "Error",
            message: String(error?.message ?? error).slice(0, 8000)
          }
        })
        throw error
      }
    })
  }
})
