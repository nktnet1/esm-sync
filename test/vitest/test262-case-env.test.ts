import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const test262CaseEnvironment =
  require("../../dist/script/test262-case-env.js") as typeof import("../../script/src/test262-case-env.js")

describe("Test262 subprocess environment", () => {
  it("preserves the caller's production test mode", () => {
    expect(
      test262CaseEnvironment({
        NODE_ENV: "production",
        ESM_ENV: "production-test",
        ESM_OPTIONS: "previous-options",
        TEST262_REPORT: "results.json"
      })
    ).toMatchObject({
      NODE_ENV: "production",
      ESM_ENV: "production-test",
      ESM_OPTIONS: "{cjs:false,cache:false,mode:'all'}",
      TEST262_REPORT: "results.json"
    })
  })

  it("does not leak reporter colours into machine-readable case output", () => {
    const base = {
      NODE_ENV: "production",
      FORCE_COLOR: "1",
      CLICOLOR_FORCE: "1",
      TEST262_REPORT: "results.json"
    }
    const result = test262CaseEnvironment(base)
    expect(result.FORCE_COLOR).toBeUndefined()
    expect(result.CLICOLOR_FORCE).toBeUndefined()
    expect(result).toMatchObject({
      NODE_ENV: "production",
      ESM_ENV: "production-test",
      TEST262_REPORT: "results.json"
    })
    expect(base.FORCE_COLOR).toBe("1")
  })

  it("keeps standalone development conformance behaviour", () => {
    expect(test262CaseEnvironment({ NODE_ENV: "development" })).toMatchObject({
      NODE_ENV: "development",
      ESM_ENV: "development-test"
    })
    expect(test262CaseEnvironment({})).toMatchObject({
      NODE_ENV: "development",
      ESM_ENV: "development-test"
    })
  })
})
