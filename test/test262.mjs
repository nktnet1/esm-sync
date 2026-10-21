import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"
import execa from "execa"
import globby from "globby"
import test262Parser from "test262-parser"

const require = createRequire(import.meta.url)
const setupTest262 = require("../script/setup-test262.js")
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
    isAsync: Boolean(attrs.flags.async),
    includes: attrs.includes || []
  }
}

async function runCase(filename, { expectedError, isAsync, includes }) {
  const { exitCode, stdout, stderr, timedOut } = await execa(
    process.execPath,
    ["--harmony", "-r", "../../", wrapperPath, filename, String(isAsync), JSON.stringify(includes)],
    {
      cwd: fixturePath,
      reject: false,
      timeout: 20_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        ESM_ENV: "development-test",
        ESM_OPTIONS: "{cjs:false,cache:false}"
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

const cases = files.map((filename) => ({
  filename,
  relativePath: path.relative(corpusPath, filename),
  skippedReason: skiplist.get(path.normalize(filename)),
  ...readCase(filename)
}))
const excluded = cases.filter(({ skippedReason }) => skippedReason !== undefined)

if (excluded.length === cases.length) {
  throw new Error("No runnable Test262 cases remain after applying the skiplist")
}

if (excluded.length > 0) {
  console.info(`Test262: excluding ${excluded.length} known cases from test/test262/skiplist`)
}

describe(`Test262 conformance (${setupTest262.revision})`, { concurrency: 4 }, () => {
  for (const testCase of cases) {
    if (testCase.skippedReason !== undefined) continue

    it(`${testCase.description} (${testCase.relativePath})`, async () => {
      await runCase(testCase.filename, testCase)
    })
  }
})
