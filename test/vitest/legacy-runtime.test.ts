import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

for (const esmEnv of testEnvironments) {
  describe(`legacy loader realm (${esmEnv})`, () => {
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
      assert.equal(result.exitCode, 0, result.stderr || result.stdout)
      assert.equal(result.stdout.trim(), "legacy-realm:pass")
    })
  })
}
