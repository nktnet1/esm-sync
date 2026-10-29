import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, it, expect } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"
import { withCompatibilityFiles } from "./helpers/coverage.ts"

for (const esmEnv of testEnvironments) {
  describe(`legacy loader realm (${esmEnv})`, () => {
    it("preserves CommonJS stack columns with cold, warm, and disabled bytecode caches", async () => {
      await withCompatibilityFiles(
        {
          "first.js": "throw new Error('first-line-marker')",
          "second.js": "\nthrow new Error('second-line-marker')",
          "syntax.js": "const value = ;",
          "index.cjs": `const assert = require('node:assert/strict')
const fs = require('node:fs')
const locations = []
for (const name of ['first', 'second']) {
  const filename = fs.realpathSync(require.resolve('./' + name + '.js'))
  try { require(filename); assert.fail('expected module failure') } catch (error) {
    const frame = error.stack.split('\\n').find(line => line.includes(filename + ':'))
    const location = frame.match(/:(\\d+):(\\d+)\\)?$/)
    locations.push([filename, Number(location[1]), Number(location[2])])
  }
}
let syntax
try { require('./syntax.js'); assert.fail('expected syntax failure') } catch (error) {
  assert.equal(error.name, 'SyntaxError')
  syntax = error.stack.split('\\n').slice(0, 3)
}
console.log(JSON.stringify({locations, syntax}))`
        },
        async (directory) => {
          const native = await runNode(["index.cjs"], esmEnv, {}, { cwd: directory })
          expect(native.exitCode, native.stderr).toBe(0)
          const nativeReport = JSON.parse(native.stdout) as {
            locations: [string, number, number][]
          }
          expect(nativeReport.locations).toStrictEqual([
            [path.join(directory, "first.js"), 1, 7],
            [path.join(directory, "second.js"), 2, 7]
          ])
          const loader = path.join(
            realpathSync(fileURLToPath(new URL("../../", import.meta.url))),
            "dist/esm.js"
          )
          for (const cache of [false, "./esm-cache"]) {
            for (let run = 0; run < 2; run++) {
              const result = await runNode(
                ["-r", loader, "index.cjs"],
                esmEnv,
                { ESM_OPTIONS: JSON.stringify({ cjs: true, mode: "auto", debug: true, cache }) },
                { cwd: directory }
              )
              expect(result.exitCode, `${cache}, ${run}\n${result.stderr}`).toBe(0)
              expect(result.stdout).toBe(native.stdout)
            }
          }
        }
      )
    })

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
