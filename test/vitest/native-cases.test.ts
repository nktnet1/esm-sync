import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { collectNativeCases } from "./native-cases.ts"

const windowsOnly = "should support requests with trailing backslashes in Windows"
const nonWindowsOnly = "should support requests containing unsafe characters in ESM"

function caseNames(platform: NodeJS.Platform): string[] {
  return collectNativeCases("misc-tests.js", platform).map(({ name }) => name)
}

describe("native platform-specific test discovery", () => {
  it("registers the Windows-only case on Windows", () => {
    const names = caseNames("win32")
    assert.ok(names.includes(windowsOnly))
    assert.ok(!names.includes(nonWindowsOnly))
  })

  it("registers the non-Windows case on Linux", () => {
    const names = caseNames("linux")
    assert.ok(names.includes(nonWindowsOnly))
    assert.ok(!names.includes(windowsOnly))
  })

  it("preserves all platform-independent cases", () => {
    const excluded = new Set([windowsOnly, nonWindowsOnly])
    const otherCases = (platform: NodeJS.Platform) =>
      caseNames(platform).filter((name) => !excluded.has(name))

    assert.deepEqual(otherCases("win32"), otherCases("linux"))
  })
})
