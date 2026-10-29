import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it, expect } from "vitest"
import resolveExports from "../../dist/build/resolve-exports.js"
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
      expect(
        resolveExports(
          { "./feature/*.js": "./dist/*/*.cjs" },
          packagePath,
          `feature/${captured}.js`
        )
      ).toBe(path.join(packagePath, "dist", captured, captured + ".cjs"))
    })
  }

  it("supports patterns without a trailing suffix and nested conditions", () => {
    expect(
      resolveExports(
        { "./feature/*": { require: { node: "./dist/*/*.cjs" }, default: "./wrong.cjs" } },
        packagePath,
        "feature/leaf"
      )
    ).toBe(path.join(packagePath, "dist/leaf/leaf.cjs"))
  })

  it("does not skip a valid array target merely because its file is missing", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-export-patterns-"))
    directories.push(directory)
    await mkdir(path.join(directory, "dist/leaf"), { recursive: true })
    const filename = path.join(directory, "dist/leaf/leaf.cjs")
    await writeFile(filename, "module.exports = 42\n")
    expect(
      resolveExports(
        { "./feature/*.js": ["./missing/*/*.cjs", { require: "./dist/*/*.cjs" }] },
        directory,
        "feature/leaf.js"
      )
    ).toBe(path.join(directory, "missing/leaf/leaf.cjs"))
    expect(
      resolveExports(
        { "./feature/*.js": ["invalid", { require: "./dist/*/*.cjs" }] },
        directory,
        "feature/leaf.js"
      )
    ).toBe(filename)
  })

  it("keeps exact entries ahead of patterns and does not prefix-match exact entries", () => {
    const exports = { "./feature/*": "./pattern/*.cjs", "./feature/leaf": "./exact.cjs" }
    expect(resolveExports(exports, packagePath, "feature/leaf")).toBe(
      path.join(packagePath, "exact.cjs")
    )
    expect(() =>
      resolveExports({ "./feature": "./exact.cjs" }, packagePath, "feature-extra")
    ).toThrow(expect.objectContaining({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }))
  })

  it("rejects nonmatching, overlapping, and multiple-wildcard keys", () => {
    for (const [key, subpath] of [
      ["./feature/*.js", "other/leaf.js"],
      ["./feature/*.js", "feature/leaf.json"],
      ["./ab*bc", "abc"],
      ["./feature/**", "feature/leaf"]
    ] as const)
      expect(() => resolveExports({ [key]: "./dist/*.cjs" }, packagePath, subpath)).toThrow(
        expect.objectContaining({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" })
      )
  })

  it("preserves unconditional targets and condition insertion order", () => {
    expect(resolveExports("./literal*.cjs", packagePath, "")).toBe(
      path.join(packagePath, "literal*.cjs")
    )
    expect(
      resolveExports(
        { require: "./require.cjs", node: "./node.cjs", default: "./default.cjs" },
        packagePath,
        ""
      )
    ).toBe(path.join(packagePath, "require.cjs"))
    expect(resolveExports({ node: "./node.cjs", require: "./require.cjs" }, packagePath, "")).toBe(
      path.join(packagePath, "node.cjs")
    )
    expect(
      resolveExports(
        { require: "./require.cjs", import: "./import.mjs" },
        packagePath,
        "",
        "import"
      )
    ).toBe(path.join(packagePath, "import.mjs"))
  })

  it("uses the most specific pattern regardless of declaration order", () => {
    for (const exports of [
      { "./*": "./wrong.cjs", "./feature/*": "./also-wrong.cjs", "./feature/*.js": "./dist/*.cjs" },
      { "./feature/*.js": "./dist/*.cjs", "./feature/*": "./also-wrong.cjs", "./*": "./wrong.cjs" }
    ])
      expect(resolveExports(exports, packagePath, "feature/leaf.js")).toBe(
        path.join(packagePath, "dist/leaf.cjs")
      )
  })

  it("keeps exact and null entries authoritative over folder and pattern mappings", () => {
    expect(
      resolveExports({ "./": "./dist/", "./public.js": "./exact.cjs" }, packagePath, "public.js")
    ).toBe(path.join(packagePath, "exact.cjs"))
    expect(() =>
      resolveExports({ "./": "./dist/", "./private/": null }, packagePath, "private/secret.js")
    ).toThrow(expect.objectContaining({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }))
    expect(() =>
      resolveExports({ "./folder/": "./not-a-folder.cjs" }, packagePath, "folder/leaf.js")
    ).toThrow(expect.objectContaining({ code: "ERR_INVALID_PACKAGE_TARGET" }))
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
    expect(result.exitCode, result.stderr || result.stdout).toBe(0)
    expect(result.stdout.trim()).toBe("resolution-safety:ok")
  })
}
