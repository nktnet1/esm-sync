import { describe, it, expect } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

const program = `const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../esm.js')(module)
const local = load('./fixture/require-bindings/local.js')
const imported = load('./fixture/require-bindings/imported.js')
const interop = load('./fixture/require-bindings/interop.js')
assert.equal(local.beforeInitialization, 'ReferenceError')
assert.equal(local.exports, 'module scope')
assert.equal(typeof local.require, 'function')
assert.strictEqual(local.default, local.require)
assert.strictEqual(local.shorthand.require, local.require)
assert.strictEqual(local.mixin.require('node:path'), path)
assert.equal(local.shadowed('nested scope'), 'nested scope')
assert.strictEqual(imported.require, local.require)
assert.strictEqual(imported.path, path)
assert.strictEqual(interop, local.require)
assert.strictEqual(load('./fixture/require-bindings/interop.js'), interop)
assert.strictEqual(imported.interop['module.exports'], local.require)
assert.strictEqual(imported.interop.default, local.require)
assert.equal(imported.interop.exports, 'module scope')
assert.strictEqual(imported.interop.shorthand.require, local.require)
assert.strictEqual(load('./fixture/require-bindings/undefined.js'), undefined)
console.log('require-bindings:ok')`

describe("module-local require bindings", () => {
  for (const esmEnv of testEnvironments) {
    for (const cjs of [false, true]) {
      it(`preserves lexical bindings, exports, and property names (${esmEnv}, cjs:${cjs})`, async () => {
        // A second process exercises the persisted compiler and V8 cache.
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await runNode(
            ["-e", program],
            esmEnv,
            { ESM_OPTIONS: JSON.stringify({ cjs, mode: "auto" }) },
            { cacheNamespace: `require-bindings-${cjs}` }
          )
          expect(result.exitCode, result.stderr || result.stdout).toBe(0)
          expect(result.stdout.trim()).toBe("require-bindings:ok")
        }
      })
    }
  }
})
