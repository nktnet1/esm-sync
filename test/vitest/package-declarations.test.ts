import { readFileSync } from "node:fs"
import path from "node:path"
import { it, expect } from "vitest"
import ts from "typescript"

it("keeps generated CJS package exports and legacy entry points compatible", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    main: string
    types: string
    exports: Record<string, unknown>
  }
  const esm = { types: "./dist/esm.d.ts", default: "./dist/esm.js" }
  const index = { types: "./dist/index.d.ts", default: "./dist/index.js" }
  expect(pkg.main.replace(/^\.\//, "")).toBe("dist/esm.js")
  expect(pkg.types.replace(/^\.\//, "")).toBe("dist/esm.d.ts")
  expect(pkg.exports).toStrictEqual({
    ".": esm,
    "./esm": esm,
    "./esm.js": esm,
    "./index": index,
    "./index.js": index,
    "./package.json": "./package.json"
  })
})

function checkPublishedTypes(filename: string, esModuleInterop = false): void {
  const options: ts.CompilerOptions = {
    strict: true,
    ...(esModuleInterop ? { esModuleInterop: true } : {}),
    noEmit: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    types: ["node"]
  }
  const program = ts.createProgram([path.resolve(filename)], options)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  expect(
    diagnostics.length,
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n"
    })
  ).toBe(0)
}

it("resolves generated CommonJS declarations through every published subpath", () => {
  checkPublishedTypes("test/fixture/typecheck/published.cts")
})

it("resolves generated ESM declarations through every published subpath", () => {
  checkPublishedTypes("test/fixture/typecheck/published.mts", true)
})

it("resolves declarations for physical compatibility entries", () => {
  checkPublishedTypes("test/fixture/typecheck/legacy-paths.cts")
})
