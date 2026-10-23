import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import execa from "execa"
import { describe, it } from "vitest"
import { testPath } from "./helpers/run-node.mts"

const fixtureDirectory = path.join(
  testPath,
  "vendor/test262/test/language/expressions/dynamic-import/namespace"
)
const test262Directory = path.join(testPath, "test262")
const wrapperPath = path.join(test262Directory, "wrapper.js")

async function runScript(filename: string) {
  const { exitCode, stdout, stderr } = await execa(
    process.execPath,
    ["--harmony", "-r", "../../", wrapperPath, filename, "true", "[]", "false"],
    {
      cwd: test262Directory,
      timeout: 20_000,
      reject: false,
      env: {
        ...process.env,
        NODE_ENV: "development",
        ESM_ENV: "development-test",
        ESM_OPTIONS: "{cjs:false,cache:false}"
      }
    }
  )

  assert.equal(exitCode, 0, `${filename}: ${stderr || stdout}`)
  assert.equal(stderr, "", `${filename}: unexpected stderr`)
  // The wrapper reports failed Test262 assertions on stdout without failing
  // the subprocess, so exitCode alone is not sufficient.
  assert.equal(stdout, "", `${filename}: ${stdout}`)
}

describe("Test262 native module fixtures", () => {
  for (const filename of [
    "await-ns-delete-non-exported-no-strict.js",
    "await-ns-delete-non-exported-strict.js",
    "default-property-not-set-own.js",
    "promise-then-ns-delete-non-exported-no-strict.js",
    "promise-then-ns-delete-non-exported-strict.js"
  ]) {
    it(`treats syntax-free ${filename} dependencies as ESM`, async () => {
      await runScript(path.join(fixtureDirectory, filename))
    })
  }

  it("does not reclassify unrelated CommonJS imports", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-test262-fixtures-"))
    try {
      await writeFile(path.join(directory, "fixture.js"), "module.exports = 41\n")
      const filename = path.join(directory, "script.js")
      await writeFile(
        filename,
        `import("./fixture.js")
  .then((ns) => {
    assert.sameValue(ns.default, 41)
    assert.sameValue(Object.hasOwn(ns, "default"), true)
  })
  .then($DONE, $DONE)
`
      )
      await runScript(filename)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
