import { describe, it, expect } from "vitest"
import { collectNativeCases } from "./native-cases.ts"

const windowsOnly = "should support requests with trailing backslashes in Windows"
const nonWindowsOnly = "should support requests containing unsafe characters in ESM"

function caseNames(platform: NodeJS.Platform): string[] {
  return collectNativeCases("misc-tests.js", platform).map(({ name }) => name)
}

describe("native platform-specific test discovery", () => {
  it("registers the Windows-only case on Windows", () => {
    const names = caseNames("win32")
    expect(names).toContain(windowsOnly)
    expect(names).not.toContain(nonWindowsOnly)
  })

  it("registers the non-Windows case on Linux", () => {
    const names = caseNames("linux")
    expect(names).toContain(nonWindowsOnly)
    expect(names).not.toContain(windowsOnly)
  })

  it("preserves all platform-independent cases", () => {
    const excluded = new Set([windowsOnly, nonWindowsOnly])
    const otherCases = (platform: NodeJS.Platform) =>
      caseNames(platform).filter((name) => !excluded.has(name))

    expect(otherCases("win32")).toStrictEqual(otherCases("linux"))
  })
})
