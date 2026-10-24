const { describe, it } = globalThis.__esmSyncNativeTest
import SemVer from "semver"

import assert from "assert"

const canTestAsyncIterators = SemVer.satisfies(process.version, ">=10")

describe("top-level await tests", { skip: !canTestAsyncIterators }, () => {

  it("should support `options.await`", () =>
    Promise
      .all([
        "./fixture/top-level-await/empty.cjs.js",
        "./fixture/top-level-await/empty.esm.js",
        "./fixture/top-level-await/export.cjs.js",
        "./fixture/top-level-await/iterator.js",
        "./fixture/top-level-await/nested.js"
      ]
      .map((request) => import(request)))
  )

  it("should finish ES modules with exports when `options.await` is enabled", () =>
    Promise
      .all([
        "./fixture/top-level-await/export.esm.js",
        "./fixture/top-level-await/re-export.js"
      ]
      .map((request) => import(request)))
      .then(([local, reexported]) => {
        assert.strictEqual(local.a, "a")
        assert.strictEqual(reexported.a, "a")
      })
  )
})
