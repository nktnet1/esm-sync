import { describe, it } from "vitest"
import Compiler from "../../dist/build/compiler.js"

import assert from "assert"
import fs from "fs-extra"
import globby from "globby"
import path from "path"
import { fileURLToPath } from "node:url"

const SCRIPT = 1
const MODULE = 2

const files = globby.sync("**/*.{js,mjs}", {
  absolute: true,
  cwd: fileURLToPath(new URL("../output/", import.meta.url))
})

const tests = files.reduce<
  Record<string, Partial<Record<"actual" | "expected", { content: string; sourceType: number }>>>
>((tests, thePath) => {
  const dirPath = path.dirname(thePath)
  const kind = path.basename(thePath).replace(/\.m?js$/, "")
  assert.ok(kind === "actual" || kind === "expected")

  if (!tests[dirPath]) {
    tests[dirPath] = {}
  }

  tests[dirPath]![kind] = {
    content: fs.readFileSync(thePath, "utf8"),
    sourceType: path.extname(thePath) === ".mjs" ? MODULE : SCRIPT
  }

  return tests
}, {})

describe("output tests", () => {
  const dirPaths = Object.keys(tests)

  for (const dirPath of dirPaths) {
    const name = path.basename(dirPath).split("-").join(" ")
    const test = tests[dirPath]!
    assert.ok(test.actual && test.expected, `Incomplete output fixture: ${dirPath}`)
    const { actual: input, expected: output } = test

    it(`compiles ${name} example as expected`, () => {
      const result = Compiler.compile(input.content, {
        sourceType: input.sourceType
      })

      const expected = output.content.trimRight()

      // Remove zero-width joiners and trim lines.
      const actual = result.code
        .replace(/\u200D/g, "")
        .replace(/[ \t]+$/gm, "")
        .trimRight()

      assert.strictEqual(actual, expected)
    })
  }
})
