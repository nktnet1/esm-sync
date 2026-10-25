import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { it } from "vitest"
import ts from "typescript"

it("keeps generated CJS package exports and legacy entry points compatible", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    main: string
    types: string
    exports: Record<string, unknown>
  }
  const esm = { types: "./dist/esm.d.ts", default: "./dist/esm.js" }
  const index = { types: "./dist/index.d.ts", default: "./dist/index.js" }
  assert.equal(pkg.main.replace(/^\.\//, ""), "dist/esm.js")
  assert.equal(pkg.types.replace(/^\.\//, ""), "dist/esm.d.ts")
  assert.deepEqual(pkg.exports, {
    ".": esm,
    "./esm": esm,
    "./esm.js": esm,
    "./index": index,
    "./index.js": index,
    "./package.json": "./package.json"
  })
})

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
