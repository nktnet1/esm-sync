import { describe, expect, it } from "vitest"
import Compiler from "../../dist/build/compiler.js"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

const prefix = "import 'node:path'\n"

describe("fatal tokenizer errors", () => {
  it.each([
    { name: "zero-width space", token: "\u200b", column: 0 },
    { name: "bare zero-width non-joiner", token: "\u200c", column: 0 },
    { name: "bare zero-width joiner", token: "\u200d", column: 0 },
    { name: "NUL character", token: "\0", column: 0 },
    { name: "unterminated comment", token: "/*", column: 0 },
    { name: "invalid binary number", token: "0b2", column: 2 }
  ])("rejects $name without resuming tokenization", async ({ token, column }) => {
    const source = `${prefix}${token}\nexport default {}\n`
    // A tokenizer regression must fail this child, not exhaust the Vitest
    // worker's heap or prevent the rest of the suite from completing.
    const code = `global.__global__ = global
global.__non_webpack_require__ = require
const compiler = require('../build/compiler.js')
try {
  compiler.compile(${JSON.stringify(source)}, { sourceType: 2 })
  console.log(JSON.stringify({ compiled: true }))
} catch (error) {
  console.log(JSON.stringify({ name: error.name, line: error.line, column: error.column }))
}
`
    const result = await runNode(
      ["--max-old-space-size=96", "-e", code],
      testEnvironments[0]!,
      {},
      { timeout: 5_000 }
    )
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toStrictEqual({ name: "SyntaxError", line: 2, column })

    const native = await runNode(
      ["--input-type=module", "--check"],
      testEnvironments[0]!,
      {},
      { input: source, timeout: 5_000 }
    )
    expect(native.exitCode, native.stderr).toBe(1)
    expect(native.stderr).toContain("SyntaxError")
  })
})

describe("legal Unicode in module source", () => {
  it.each([
    { name: "zero-width space in a string", source: 'export default "\u200b"' },
    { name: "zero-width space in a template", source: "export default `\u200b`" },
    { name: "zero-width space in a comment", source: "// \u200b\nexport default 42" },
    { name: "zero-width space in a property name", source: 'export default {"\u200b": 42}' },
    { name: "non-joiner in an identifier", source: "const a\u200cb = 42; export {a\u200cb}" },
    { name: "joiner in an identifier", source: "const a\u200db = 42; export {a\u200db}" },
    { name: "byte-order mark as whitespace", source: "\ufeffexport default 42" }
  ])("accepts $name", ({ source }) => {
    expect(() => Compiler.compile(source, { sourceType: 2 })).not.toThrow()
  })
})
