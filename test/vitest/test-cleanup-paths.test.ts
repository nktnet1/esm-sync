import path from "node:path"
import { describe, it, expect } from "vitest"
import { createRequire } from "node:module"
const createTestCleanupFilter = createRequire(import.meta.url)(
  "../../dist/script/test-cleanup-paths.js"
) as typeof import("../../script/src/test-cleanup-paths.js")

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
        expect(shouldClean(paths.join(root, relative)), relative).toBe(false)
      }

      expect(shouldClean(paths.join(root, "node_modules/.cache"))).toBe(true)
      expect(shouldClean(paths.join(root, "test/fixture/old.cache"))).toBe(true)
      expect(shouldClean(paths.join(root, "test/env/native-cache"))).toBe(true)
      expect(shouldClean(paths.join(root, "build-extra"))).toBe(true)
    })
  }

  it("handles mixed separators and drive-letter case in Windows glob results", () => {
    const shouldClean = filterFor("D:\\a\\esm-sync\\esm-sync", path.win32)

    expect(shouldClean("d:/A/esm-sync/esm-sync/node_modules")).toBe(false)
    expect(shouldClean("d:/A/esm-sync/esm-sync/src/vendor/acorn")).toBe(false)
    expect(shouldClean("d:/A/esm-sync/esm-sync/node_modules/.cache")).toBe(true)
  })
})
