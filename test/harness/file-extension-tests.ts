import type { Namespace } from "./native-types.js"
const { describe, it } = globalThis.__esmSyncNativeTest
import assert from "assert"
import require2 from "./require.cjs"
describe("file extension tests", () => {
  it("should not error importing `.mjs` files", () =>
    import("./fixture/ext/a.mjs" as string) as Promise<Namespace>)
  it("should not error loading `.cjs` files with `options.cjs.paths`", () =>
    Promise.all(
      ["./fixture/cjs/ext/import-cjs-ext.js", "./fixture/cjs/ext/require-cjs-ext.js"].map(
        (request) => import(request as string) as Promise<Namespace>
      )
    ))
  it("should error importing extensionless files from ESM", () =>
    Promise.all(
      ["./fixture/ext/no-ext-cjs", "./fixture/ext/no-ext-esm"].map((request) =>
        (import(request as string) as Promise<Namespace>).then(
          () => assert.fail(request + " imported without error, but should have failed"),
          (e: unknown) => {
            if ((e as { code?: unknown })?.code === "ERR_ASSERTION") {
              throw e
            }
            assert.strictEqual((e as { code?: unknown })?.code, "ERR_UNKNOWN_FILE_EXTENSION")
          }
        )
      )
    ))
  it("should not error loading extensionless files with `options.cjs.paths`", () =>
    Promise.all(
      ["./fixture/cjs/ext/import-no-ext.js", "./fixture/cjs/ext/require-no-ext.js"].map(
        (request) => import(request as string) as Promise<Namespace>
      )
    ))
  it("should not error requiring extensionless files", () => {
    require2("./fixture/ext/no-ext-cjs")
  })
  it("should error importing files with unknown extensions from ESM", () =>
    Promise.all(
      [
        "./fixture/ext/a.unknown-ext-cjs",
        "./fixture/ext/a.unknown-ext-esm",
        "./fixture/cjs/ext/a.unknown-ext-cjs",
        "./fixture/cjs/ext/a.unknown-ext-esm"
      ].map((request) =>
        (import(request as string) as Promise<Namespace>)
          .then(() => assert.fail("Expected the import to reject"))
          .catch(({ code }: { code?: unknown }) =>
            assert.strictEqual(code, "ERR_UNKNOWN_FILE_EXTENSION")
          )
      )
    ))
  it("should not error loading files with unknown extensions with `options.cjs.paths`", () =>
    Promise.all(
      ["./fixture/cjs/ext/import-unknown-ext.js", "./fixture/cjs/ext/require-unknown-ext.js"].map(
        (request) => import(request as string) as Promise<Namespace>
      )
    ))
  it("should not error requiring unknown extensions", () => {
    require2("./fixture/ext/a.unknown-ext-cjs")
  })
  it('should error importing non `.mjs` ES modules from `.mjs` files with `options.mode` of "strict"', () =>
    (import("./fixture/ext/invalid.mjs" as string) as Promise<Namespace>)
      .then(() => assert.fail("Expected the import to reject"))
      .catch((e: unknown) => {
        assert.ok(e instanceof SyntaxError)
        assert.ok(e.message.startsWith("Unexpected token export"))
      }))
  it('should error importing non `.mjs` ES modules from `.mjs` files with `options.mode` of "auto"', () =>
    (import("./fixture/cjs/ext/invalid.mjs" as string) as Promise<Namespace>)
      .then(() => assert.fail("Expected the import to reject"))
      .catch(({ message }: { message: string }) => {
        assert.ok(message.startsWith("Cannot load module"))
      }))
})
