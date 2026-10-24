import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "vitest"
import createTestCleanupFilter from "../../script/test-cleanup-paths.js"

function filterFor(root: string, paths: typeof path) {
  const keptPaths = ["build", "esm", "node_modules", "src/vendor", "test/vendor"].map((part) =>
    paths.resolve(root, part)
  )

  return createTestCleanupFilter(
    {
      keptPaths,
      nodeModulesPath: paths.resolve(root, "node_modules"),
      sharedCachePath: paths.resolve(root, "node_modules/.cache")
    },
    paths
  )
}

describe("test fixture cleanup safety", () => {
  const platforms: Array<[string, string, typeof path]> = [
    ["POSIX", "/repo/esm-sync", path.posix],
    ["Windows", "D:\\a\\esm-sync\\esm-sync", path.win32]
  ]
  for (const [platform, root, paths] of platforms) {
    it(`preserves built assets, vendor fixtures and dependencies on ${platform}`, () => {
      const shouldClean = filterFor(root, paths)

      for (const relative of [
        "build",
        "build/compiler.js",
        "esm",
        "node_modules",
        "node_modules/.pnpm/pkg",
        "src/vendor",
        "test/vendor"
      ]) {
        assert.equal(shouldClean(paths.join(root, relative)), false, relative)
      }

      assert.equal(shouldClean(paths.join(root, "node_modules/.cache")), true)
      assert.equal(shouldClean(paths.join(root, "test/fixture/old.cache")), true)
      assert.equal(shouldClean(paths.join(root, "test/env/native-cache")), true)
      assert.equal(shouldClean(paths.join(root, "build-extra")), true)
    })
  }

  it("handles mixed separators and drive-letter case in Windows glob results", () => {
    const shouldClean = filterFor("D:\\a\\esm-sync\\esm-sync", path.win32)

    assert.equal(shouldClean("d:/A/esm-sync/esm-sync/node_modules"), false)
    assert.equal(shouldClean("d:/A/esm-sync/esm-sync/src/vendor/acorn"), false)
    assert.equal(shouldClean("d:/A/esm-sync/esm-sync/node_modules/.cache"), true)
  })
})
