import assert from "node:assert/strict"
import { createRequire } from "node:module"
import vm from "node:vm"
import { it } from "vitest"
import options from "../../config/babel.ts"

const require = createRequire(import.meta.url)
const babel = require("@babel/core") as {
  transformSync(source: string, options: object): { code?: string | null } | null
}

it("preserves custom strict/sloppy functions and equality transforms", () => {
  const result = babel.transformSync(
    `function ordinary() { return this === undefined }
function sloppy() { "use sloppy"; return (function () { return this !== undefined })() }
function equal(value) { return value == 1 }
function nullish(value) { return value == null }
globalThis.strictThis = ordinary()
globalThis.sloppyThis = sloppy()
globalThis.strictComparison = equal("1")
globalThis.nullComparison = nullish(undefined)`,
    {
      ...options,
      filename: "build-semantics.js",
      sourceType: "script",
      configFile: false,
      babelrc: false,
      envName: "development"
    }
  )
  assert.equal(typeof result?.code, "string")
  const context: Record<string, unknown> = {}
  vm.runInNewContext(result!.code!, context)
  assert.equal(context.strictThis, true)
  assert.equal(context.sloppyThis, true)
  assert.equal(context.strictComparison, false)
  assert.equal(context.nullComparison, true)
})
