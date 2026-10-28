import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "acorn"
import { describe, it, expect } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

const root = fileURLToPath(new URL("../../", import.meta.url))
const bundles = [
  "compiler.js",
  "entry.js",
  "get-file-path-from-url.js",
  "get-url-from-file-path.js",
  "resolve-exports.js",
  "runtime.js"
]

describe("build output contract", () => {
  it("emits standalone test bundles without additional shared chunks", async () => {
    const files = await readdir(path.join(root, "dist/build"), { recursive: true })
    expect(files.filter((name) => name.endsWith(".js")).sort()).toStrictEqual(bundles)
  })

  it("keeps published JavaScript and test bundles compatible with ES2015 syntax", async () => {
    for (const filename of [
      "dist/esm/loader.js",
      "dist/esm.js",
      "dist/index.js",
      "dist/script/build-sync-await.js",
      ...bundles.map((name) => "dist/build/" + name)
    ]) {
      const source = await readFile(path.join(root, filename), "utf8")
      expect(
        () => parse(source, { ecmaVersion: 2015, sourceType: "script", allowHashBang: true }),
        filename
      ).not.toThrow()
    }
  })

  it("preserves effective strict directives in loader, index, and installer output", async () => {
    for (const filename of [
      "dist/esm/loader.js",
      "dist/index.js",
      "dist/script/build-sync-await.js",
      ...bundles.map((name) => "dist/build/" + name)
    ]) {
      const source = await readFile(path.join(root, filename), "utf8")
      const first = parse(source, { ecmaVersion: 2015, sourceType: "script" }).body[0]
      expect(first, filename).toMatchObject({
        type: "ExpressionStatement",
        directive: "use strict"
      })
    }
  })

  for (const esmEnv of testEnvironments) {
    it(`loads native CommonJS entry points when string code generation is disabled (${esmEnv})`, async () => {
      const result = await runNode(
        [
          "--disallow-code-generation-from-strings",
          "-e",
          `const assert = require('node:assert/strict')
const factory = require('../esm.js')
assert.equal(typeof factory, 'function')
assert.strictEqual(factory, require('../index.js'))
assert.equal(typeof require('../script/build-sync-await.js'), 'function')
console.log('public-commonjs:ok')`
        ],
        esmEnv,
        {},
        { cacheNamespace: "public-commonjs" }
      )
      expect(result.exitCode, result.stderr || result.stdout).toBe(0)
      expect(result.stdout.trim()).toBe("public-commonjs:ok")
    })
  }
})
