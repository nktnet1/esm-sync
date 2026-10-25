import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "acorn"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

const root = fileURLToPath(new URL("../../", import.meta.url))
const bundles = [
  "compiler.js",
  "entry.js",
  "esm.js",
  "get-file-path-from-url.js",
  "get-url-from-file-path.js",
  "resolve-exports.js",
  "runtime.js"
]

describe("build output contract", () => {
  it("emits standalone test bundles without additional shared chunks", async () => {
    const files = await readdir(path.join(root, "build"), { recursive: true })
    assert.deepEqual(files.filter((name) => name.endsWith(".js")).sort(), bundles)
  })

  it("keeps published JavaScript and test bundles compatible with ES2015 syntax", async () => {
    for (const filename of [
      "esm.js",
      "index.js",
      "script/build-sync-await.js",
      ...bundles.map((name) => "build/" + name)
    ]) {
      const source = await readFile(path.join(root, filename), "utf8")
      assert.doesNotThrow(
        () => parse(source, { ecmaVersion: 2015, sourceType: "script", allowHashBang: true }),
        filename
      )
    }
  })

  it("preserves effective strict directives in loader, index, and installer output", async () => {
    for (const filename of [
      "index.js",
      "script/build-sync-await.js",
      ...bundles.map((name) => "build/" + name)
    ]) {
      const source = await readFile(path.join(root, filename), "utf8")
      const first = parse(source, { ecmaVersion: 2015, sourceType: "script" }).body[0]
      assert.ok(first?.type === "ExpressionStatement" && first.directive === "use strict", filename)
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
      assert.equal(result.exitCode, 0, result.stderr || result.stdout)
      assert.equal(result.stdout.trim(), "public-commonjs:ok")
    })
  }
})
