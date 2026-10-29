import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, it, expect } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"
import { withCompatibilityFiles } from "./helpers/coverage.ts"

for (const esmEnv of testEnvironments) {
  describe(`legacy loader realm (${esmEnv})`, () => {
    it("installs preload hooks through each physical compatibility shim", async () => {
      const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)))
      await withCompatibilityFiles(
        {
          "entry.js": "import { answer } from './value.js'; console.log(answer)",
          "value.js": "export const answer = 42"
        },
        async (directory) => {
          for (const entry of ["esm.js", "index.js", "dist/esm.js", "dist/index.js"]) {
            const result = await runNode(
              ["-r", path.join(root, entry), "entry.js"],
              esmEnv,
              {
                ESM_OPTIONS: "{cjs:true,mode:'auto'}",
                // Native syntax detection can hide a missing preload hook.
                NODE_OPTIONS: "--no-experimental-require-module --no-experimental-detect-module"
              },
              { cwd: directory, cacheNamespace: `legacy-preload-${path.basename(entry)}` }
            )
            expect(result.exitCode, `${entry}\n${result.stderr}`).toBe(0)
            expect(result.stdout.trim()).toBe("42")
          }
        }
      )
    })

    it("loads physical compatibility entries without consulting package exports", async () => {
      const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)))
      const source = `
const assert = require('node:assert/strict')
const path = require('node:path')
const root = ${JSON.stringify(root)}
const factory = require(path.join(root, 'dist/esm.js'))
for (const entry of ['esm', 'index']) {
  assert.equal(require(path.join(root, entry)), factory)
  assert.equal(require(path.join(root, entry + '.js')), factory)
}
console.log('legacy-paths:pass')
`
      const result = await runNode(["-e", source], esmEnv, {}, { cacheNamespace: "legacy-paths" })
      expect(result.exitCode, result.stderr || result.stdout).toBe(0)
      expect(result.stdout.trim()).toBe("legacy-paths:pass")
    })

    it("bootstraps and loads ESM without a globalThis binding in its realm", async () => {
      const source = `
const assert = require('node:assert/strict')
const vm = require('node:vm')
const runInNewContext = vm.Script.prototype.runInNewContext
vm.Script.prototype.runInNewContext = function (sandbox, options) {
  if (!sandbox || sandbox.global !== global) {
    return Reflect.apply(runInNewContext, this, [sandbox, options])
  }
  const context = vm.createContext(sandbox)
  vm.runInContext('delete this.globalThis', context)
  assert.equal(vm.runInContext('typeof globalThis', context), 'undefined')
  return this.runInContext(context, options)
}
const load = require('../esm.js')(module)
assert.equal(load('./fixture/legacy-runtime/value.mjs').answer, 42)
assert.equal(load('node:path').sep, require('node:path').sep)
console.log('legacy-realm:pass')
`
      const result = await runNode(
        ["-e", source],
        esmEnv,
        { ESM_OPTIONS: "{cjs:true,mode:'auto'}" },
        { cacheNamespace: "legacy-runtime" }
      )
      expect(result.exitCode, result.stderr || result.stdout).toBe(0)
      expect(result.stdout.trim()).toBe("legacy-realm:pass")
    })
  })
}
