import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { literalRegExp } from "../../src/acorn.ts"

describe("Acorn directive literal matching", () => {
  it.each([
    { source: "'use strict';", literal: "'use strict'", single: "use strict", double: undefined },
    { source: '"use strict";', literal: '"use strict"', single: undefined, double: "use strict" },
    {
      source: String.raw`'can\'t'`,
      literal: String.raw`'can\'t'`,
      single: String.raw`can\'t`,
      double: undefined
    },
    {
      source: String.raw`"say \"hi\""`,
      literal: String.raw`"say \"hi\""`,
      single: undefined,
      double: String.raw`say \"hi\"`
    },
    {
      source: String.raw`'path\\to'`,
      literal: String.raw`'path\\to'`,
      single: String.raw`path\\to`,
      double: undefined
    },
    { source: "; next", literal: ";", single: undefined, double: undefined }
  ])(
    "matches $source without changing directive captures",
    ({ source, literal, single, double }) => {
      const match = literalRegExp.exec(source)
      assert.ok(match)
      assert.equal(match[0], literal)
      assert.equal(match[1], single)
      assert.equal(match[2], double)
    }
  )

  it("recognizes escaped line continuations in directive literals", () => {
    const source = "'first\\\nsecond'"
    const match = literalRegExp.exec(source)
    assert.ok(match)
    assert.equal(match[0], source)
    assert.equal(match[1], "first\\\nsecond")
  })

  it.each(["'unfinished", '"unfinished', "'trailing\\", '"trailing\\'])(
    "does not accept an unterminated literal %s",
    (source) => assert.equal(literalRegExp.exec(source), null)
  )

  it.each(["'", '"'])("rejects long unmatched %s literals with escaped characters", (quote) => {
    // A class that also matches backslashes admits exponentially many ways
    // to partition these pairs between the escape and character branches.
    const source = quote + String.raw`\!`.repeat(2_048)
    assert.equal(literalRegExp.exec(source), null)
  })
})
