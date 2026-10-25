import type { DefaultFixture, Namespace } from "./native-types.js"
const { describe, it } = globalThis.__esmSyncNativeTest
import SemVer from "semver"
import assert from "assert"
const canTestLiveBinding = SemVer.satisfies(process.version, ">=6.2")
describe("import declaration tests", () => {
  it("should support same symbol as different locals", () =>
    (import("./import/locals.mjs" as string) as Promise<DefaultFixture>).then((ns) => ns.default()))
  it("should support mixed import styles of ES modules", () =>
    (import("./import/mixed.mjs" as string) as Promise<DefaultFixture>).then((ns) => ns.default()))
  it("should support mixed import styles of CJS modules", () =>
    (import("./cjs/import/mixed.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should support CJS modules setting `module.exports`", () =>
    (import("./cjs/import/exports.js" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it(
    "should support live binding of named exports for CJS modules",
    { skip: !canTestLiveBinding },
    () =>
      (import("./cjs/import/live.js" as string) as Promise<DefaultFixture>).then((ns) =>
        ns.default()
      )
  )
  it("should not swallow getter errors of CJS modules", () =>
    (import("./fixture/cjs/import/getter-error.js" as string) as Promise<Namespace>)
      .then(() => assert.fail("Expected the import to reject"))
      .catch((e: unknown) => {
        assert.ok(e instanceof ReferenceError)
        assert.strictEqual(e.message, "unsafe getter")
      }))
})
