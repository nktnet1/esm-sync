import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "vitest"
import ts from "typescript"
import { checkTypeSafety } from "../../script/src/esm/check-type-safety.ts"

const root = path.resolve("test/env/type-safety").replaceAll("\\", "/")
const validRoot = path.join(root, "valid")
const invalidRoot = path.join(root, "invalid")
const options: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: ["node"]
}

for (const [platform, paths] of [
  ["POSIX", path.posix],
  ["Windows", path.win32]
] as const) {
  describe(`type safety gate (${platform} source paths)`, () => {
    const sources = new Map([
      [
        paths.join(root, "invalid/script/src/probe.ts"),
        'export const parsed = JSON.parse("null");'
      ],
      [
        paths.join(root, "valid/probe.ts"),
        'export const parsed: unknown = JSON.parse("null"); export const cache = new Map<string, unknown>();'
      ],
      [
        paths.join(root, "invalid/probe.ts"),
        'export const parsed = JSON.parse("null"); export const cache = new Map();'
      ]
    ])
    const host = ts.createCompilerHost(options)
    const readFile = host.readFile.bind(host)
    // TypeScript requests forward slashes even when root names use Windows paths.
    host.readFile = (filename) => sources.get(paths.normalize(filename)) ?? readFile(filename)
    const program = ts.createProgram([...sources.keys()], options, host)

    it("accepts unknown values and explicitly typed collections", () => {
      const diagnostics = ts.getPreEmitDiagnostics(program)
      assert.equal(
        diagnostics.length,
        0,
        ts.formatDiagnostics(diagnostics, {
          getCanonicalFileName: host.getCanonicalFileName,
          getCurrentDirectory: host.getCurrentDirectory,
          getNewLine: host.getNewLine
        })
      )
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
}
