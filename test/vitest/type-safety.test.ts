import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "vitest"
import ts from "typescript"
import { checkTypeSafety } from "../../script/src/esm/check-type-safety.ts"

const root = path.resolve("test/env/type-safety")
const validRoot = path.join(root, "valid")
const invalidRoot = path.join(root, "invalid")
const sources = new Map([
  [path.join(invalidRoot, "script/src/probe.ts"), 'export const parsed = JSON.parse("null");'],
  [
    path.join(validRoot, "probe.ts"),
    'export const parsed: unknown = JSON.parse("null"); export const cache = new Map<string, unknown>();'
  ],
  [
    path.join(invalidRoot, "probe.ts"),
    'export const parsed = JSON.parse("null"); export const cache = new Map();'
  ]
])
const options: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: ["node"]
}
const host = ts.createCompilerHost(options)
const readFile = host.readFile.bind(host)
host.readFile = (filename) => sources.get(filename) ?? readFile(filename)
const program = ts.createProgram([...sources.keys()], options, host)

describe("type safety gate", () => {
  it("accepts unknown values and explicitly typed collections", () => {
    assert.equal(ts.getPreEmitDiagnostics(program).length, 0)
    assert.doesNotThrow(() => checkTypeSafety(program, validRoot))
  })

  it("rejects inferred any that TypeScript strict mode permits", () => {
    assert.throws(
      () => checkTypeSafety(program, invalidRoot),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /Type safety check failed/)
        assert.equal(error.message.match(/unchecked any/g)?.length, 3)
        return true
      }
    )
  })
})
