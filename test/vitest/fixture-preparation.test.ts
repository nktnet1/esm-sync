import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { afterEach, describe, it } from "vitest"

const require = createRequire(import.meta.url)
const setupTest262 = require("../../dist/script/setup-test262.js") as {
  isPrepared(directory: string): boolean
  revision: string
}

const dirs = [
  "harness",
  "test/language/export",
  "test/language/expressions/dynamic-import",
  "test/language/expressions/import.meta",
  "test/language/import",
  "test/language/module-code",
  "test/language/statements/using",
  "test/language/statements/await-using"
]

const created: string[] = []

afterEach(async () => {
  for (const directory of created.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function makeCorpus() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-test262-"))
  created.push(directory)
  for (const name of dirs) await mkdir(path.join(directory, name), { recursive: true })
  await writeFile(path.join(directory, "harness/assert.js"), "// assertion harness\n")
  return directory
}

describe("Test262 fixture provenance", () => {
  it("rejects an unmarked corpus, even when the harness and directories exist", async () => {
    const directory = await makeCorpus()
    assert.equal(setupTest262.isPrepared(directory), false)
  })

  it("rejects an older or different revision", async () => {
    const directory = await makeCorpus()
    await writeFile(path.join(directory, ".prepared-revision"), "0".repeat(40) + "\n")
    assert.equal(setupTest262.isPrepared(directory), false)
  })

  it("accepts a complete corpus at the pinned revision", async () => {
    const directory = await makeCorpus()
    await writeFile(path.join(directory, ".prepared-revision"), setupTest262.revision + "\n")
    assert.equal(setupTest262.isPrepared(directory), true)
  })

  it("rejects a corpus with a missing required test directory", async () => {
    const directory = await makeCorpus()
    await writeFile(path.join(directory, ".prepared-revision"), setupTest262.revision + "\n")
    await rm(path.join(directory, "test/language/module-code"), { recursive: true })
    assert.equal(setupTest262.isPrepared(directory), false)
  })

  it("requires the pinned resource-management groups in an already marked corpus", async () => {
    const directory = await makeCorpus()
    await writeFile(path.join(directory, ".prepared-revision"), setupTest262.revision + "\n")
    for (const name of ["using", "await-using"]) {
      await rm(path.join(directory, "test/language/statements", name), { recursive: true })
      assert.equal(setupTest262.isPrepared(directory), false)
      await mkdir(path.join(directory, "test/language/statements", name))
    }
  })
})
