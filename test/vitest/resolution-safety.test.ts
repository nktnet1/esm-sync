import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "vitest"
import resolveExports from "../../build/resolve-exports.js"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

const directories: string[] = []
const packagePath = path.resolve("test/env/exports-patterns")

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe("literal package export patterns", () => {
  for (const captured of ["leaf", "nested/leaf", "$&", "$`", "$'", "$$", "*"]) {
    it(`substitutes every target wildcard literally for ${JSON.stringify(captured)}`, () => {
      assert.equal(
        resolveExports(
          { "./feature/*.js": "./dist/*/*.cjs" },
          packagePath,
          `feature/${captured}.js`
        ),
        path.join(packagePath, "dist", captured, captured + ".cjs")
      )
    })
  }

  it("supports patterns without a trailing suffix and nested conditions", () => {
    assert.equal(
      resolveExports(
        { "./feature/*": { require: { node: "./dist/*/*.cjs" }, default: "./wrong.cjs" } },
        packagePath,
        "feature/leaf"
      ),
      path.join(packagePath, "dist/leaf/leaf.cjs")
    )
  })

  it("substitutes before checking array fallback files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-export-patterns-"))
    directories.push(directory)
    await mkdir(path.join(directory, "dist/leaf"), { recursive: true })
    const filename = path.join(directory, "dist/leaf/leaf.cjs")
    await writeFile(filename, "module.exports = 42\n")
    assert.equal(
      resolveExports(
        { "./feature/*.js": ["./missing/*/*.cjs", { require: "./dist/*/*.cjs" }] },
        directory,
        "feature/leaf.js"
      ),
      filename
    )
  })

  it("keeps exact entries ahead of patterns and does not prefix-match exact entries", () => {
    const exports = { "./feature/*": "./pattern/*.cjs", "./feature/leaf": "./exact.cjs" }
    assert.equal(
      resolveExports(exports, packagePath, "feature/leaf"),
      path.join(packagePath, "exact.cjs")
    )
    assert.equal(resolveExports({ "./feature": "./exact.cjs" }, packagePath, "feature-extra"), "")
  })

  it("rejects nonmatching, overlapping, and multiple-wildcard keys", () => {
    for (const [key, subpath] of [
      ["./feature/*.js", "other/leaf.js"],
      ["./feature/*.js", "feature/leaf.json"],
      ["./ab*bc", "abc"],
      ["./feature/**", "feature/leaf"]
    ] as const)
      assert.equal(resolveExports({ [key]: "./dist/*.cjs" }, packagePath, subpath), "")
  })

  it("preserves unconditional targets and CommonJS condition priority", () => {
    assert.equal(
      resolveExports("./literal*.cjs", packagePath, ""),
      path.join(packagePath, "literal*.cjs")
    )
    assert.equal(
      resolveExports(
        { require: "./require.cjs", node: "./node.cjs", default: "./default.cjs" },
        packagePath,
        ""
      ),
      path.join(packagePath, "require.cjs")
    )
  })
})

for (const esmEnv of testEnvironments) {
  it(`resolves queries with line breaks and many delimiters without backtracking (${esmEnv})`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-query-safety-"))
    directories.push(directory)
    await writeFile(path.join(directory, "value.mjs"), "export const value = 42\n")
    await writeFile(path.join(directory, "encoded#hash.mjs"), "export const value = 43\n")
    const source = `
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../esm.js')(module, { cjs: false })
const directory = ${JSON.stringify(directory)}
const filename = path.join(directory, 'value.mjs')
for (const suffix of ['?a#b', '#a?b', '?line\\nbreak', '#line\\rbreak', '?' + '#'.repeat(200_000) + '\\ntrailer']) {
  assert.equal(load(filename + suffix).value, 42)
}
const encoded = path.join(directory, 'encoded#hash.mjs').replace(/#/g, '%23')
assert.equal(load(encoded + '?query#fragment').value, 43)
console.log('resolution-safety:ok')
`
    const result = await runNode(
      ["-e", source],
      esmEnv,
      { ESM_OPTIONS: JSON.stringify({ cache: path.join(directory, "cache") }) },
      { timeout: 10_000 }
    )
    assert.equal(result.exitCode, 0, result.stderr || result.stdout)
    assert.equal(result.stdout.trim(), "resolution-safety:ok")
  })
}
