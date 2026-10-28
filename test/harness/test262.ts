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
const test262NodeFlags = require("../script/test262-node-flags.js") as string[]
const setupTest262 =
  require("../script/setup-test262.js") as typeof import("../../script/src/setup-test262.js")
const { assertTest262Outcome } =
  require("../script/test262-outcome.js") as typeof import("../../script/src/test262-outcome.js")
const {
  createReport,
  detectHostFeatures,
  detectLoaderFeatures,
  getUnsupportedHostFeatures,
  getUnsupportedLoaderFeatures,
  isGeneratedGrammarCase,
  selectCases
} =
  require("../script/test262-selection.js") as typeof import("../../script/src/test262-selection.js")
const testPath = fileURLToPath(new URL("./", import.meta.url))
const fixturePath = path.join(testPath, "test262")
const corpusPath = path.join(testPath, "vendor/test262")
const wrapperPath = path.join(fixturePath, "wrapper.js")
const skiplistPath = path.join(fixturePath, "skiplist")

if (!setupTest262.isPrepared()) {
  throw new Error(
    "The pinned Test262 corpus is missing or outdated. Run `pnpm fixtures:test262` first."
  )
}

function readSkiplist(filename: string) {
  const entries = new Map<string, string>()
  const content = readFileSync(filename, "utf8")
  const entryPattern = /^(#.*)\r?\n([^#\r\n].*)/gm

  for (const match of content.matchAll(entryPattern)) {
    const reason = match[1]!.slice(1).trim()
    const testFile = path.resolve(corpusPath, match[2]!.trim())
    entries.set(testFile, reason)
  }

  return entries
}

function readCase(filename: string) {
  const source = readFileSync(filename, "utf8")
  const { attrs } = test262Parser.parseFile(source)
  const relativePath = path.relative(corpusPath, filename).split(path.sep).join("/")
  return {
    syntaxOnly: isGeneratedGrammarCase({
      relativePath,
      flags: attrs.flags,
      includes: attrs.includes,
      expectedError: attrs.negative?.type,
      expectedPhase: attrs.negative?.phase,
      source
    }),
    description: attrs.description?.trim() || path.basename(filename),
    expectedError: attrs.negative?.type,
    expectedPhase: attrs.negative?.phase,
    isAsync: Boolean(attrs.flags.async),
    isModule: Boolean(attrs.flags.module),
    features: attrs.features || [],
    includes: attrs.includes || []
  }
}

async function runCase(
  filename: string,
  {
    expectedError,
    expectedPhase,
    isAsync,
    isModule,
    includes,
    syntaxOnly
  }: ReturnType<typeof readCase>
) {
  const { exitCode, stdout, stderr, timedOut } = await execa(
    process.execPath,
    [
      ...test262NodeFlags,
      "-r",
      "../../",
      wrapperPath,
      filename,
      String(isAsync),
      JSON.stringify(includes),
      String(isModule),
      expectedPhase ?? "",
      String(syntaxOnly)
    ],
    {
      cwd: fixturePath,
      reject: false,
      timeout: 20_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        ESM_ENV: "development-test",
        // The case itself still runs with its declared Script/Module goal.
        // Imported fixtures are modules even without import/export syntax.
        ESM_OPTIONS: "{cjs:false,cache:false,mode:'all'}"
      }
    }
  )

  assert.ok(!timedOut, `Test262 subprocess timed out: ${filename}`)
  assert.equal(exitCode, 0, `${filename}: ${stderr || stdout}`)
  assert.equal(stderr, "", `${filename}: unexpected stderr`)

  assertTest262Outcome(filename, stdout, expectedError, expectedPhase)
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

const hostFeatures = await detectHostFeatures()
const loaderFeatures = detectLoaderFeatures()
const cases = files.map((filename) => {
  const metadata = readCase(filename)
  const relativePath = path.relative(corpusPath, filename).split(path.sep).join("/")
  return {
    filename,
    relativePath,
    skippedReason: skiplist.get(path.normalize(filename)),
    unsupportedHostFeatures: getUnsupportedHostFeatures(metadata, hostFeatures),
    unsupportedLoaderFeatures: getUnsupportedLoaderFeatures(
      { ...metadata, relativePath },
      loaderFeatures
    ),
    ...metadata
  }
})
const excluded = cases.filter(({ skippedReason }) => skippedReason !== undefined)
const filter = process.env.TEST262_FILTER || ""
const excludeFeatures: unknown = JSON.parse(process.env.TEST262_EXCLUDE_FEATURES || "[]")
if (
  !Array.isArray(excludeFeatures) ||
  !excludeFeatures.every((item: unknown) => typeof item === "string")
)
  throw new TypeError("Expected Test262 feature names")
const limitValue = process.env.TEST262_LIMIT
const limit = limitValue ? Number(limitValue) : undefined
const selectedCases = selectCases(cases, {
  filter,
  ...(limit === undefined ? {} : { limit }),
  excludeFeatures: excludeFeatures as string[]
})
const unsupportedCases = selectedCases.filter(
  ({ unsupportedHostFeatures, unsupportedLoaderFeatures }) =>
    unsupportedHostFeatures.length > 0 || unsupportedLoaderFeatures.length > 0
)
const reportPath = process.env.TEST262_REPORT
const results: Parameters<typeof createReport>[0]["results"] = []

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
      expectedPhase: testCase.expectedPhase ?? null,
      ...(testCase.syntaxOnly ? { syntaxOnly: true } : {})
    }

    const { unsupportedHostFeatures, unsupportedLoaderFeatures } = testCase
    if (unsupportedHostFeatures.length > 0 || unsupportedLoaderFeatures.length > 0) {
      const unsupportedFeatureSources = {
        host: unsupportedHostFeatures,
        loader: unsupportedLoaderFeatures
      }
      const reasons: string[] = []
      if (unsupportedHostFeatures.length > 0) {
        reasons.push(`Unsupported host features: ${unsupportedHostFeatures.join(", ")}`)
      }
      if (unsupportedLoaderFeatures.length > 0) {
        reasons.push(`Unsupported loader features: ${unsupportedLoaderFeatures.join(", ")}`)
      }
      results.push({
        ...result,
        status: "unsupported",
        unsupportedFeatures: [...unsupportedHostFeatures, ...unsupportedLoaderFeatures],
        unsupportedFeatureSources
      })
      it(title, { skip: reasons.join("; ") }, () => {})
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
            name: error instanceof Error ? error.name : "Error",
            message: String(error instanceof Error ? error.message : error).slice(0, 8000)
          }
        })
        throw error
      }
    })
  }
})
