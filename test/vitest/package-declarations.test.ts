import assert from "node:assert/strict"
import path from "node:path"
import { it } from "vitest"
import ts from "typescript"

it("resolves generated CommonJS declarations through every published subpath", () => {
  const filename = path.resolve("test/fixture/typecheck/published.cts")
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    types: ["node"]
  }
  const program = ts.createProgram([filename], options)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n"
    })
  )
})
