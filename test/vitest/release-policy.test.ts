import assert from "node:assert/strict"
import { describe, it } from "vitest"
import {
  compareReleaseBases,
  nextBetaVersion,
  parseReleaseVersion,
  validateReleaseManifest,
  versionFromTag
} from "../../script/src/esm/release-policy.ts"

describe("npm release version policy", () => {
  it.each([
    ["3.3.8", "latest"],
    ["3.3.8-beta.1", "beta"],
    ["3.3.8-beta.100", "beta"]
  ])("maps %s to the %s dist-tag", (version, distTag) => {
    assert.equal(parseReleaseVersion(version).distTag, distTag)
    assert.equal(versionFromTag(`v${version}`).version, version)
  })

  it.each([
    "3.3.8-rc.1",
    "3.3.8-beta.01",
    "03.3.8",
    "3x3x8",
    "3.3.8+metadata",
    "3.3.8\n",
    "3.3.8-beta.1.extra"
  ])("rejects unsupported release version %s", (version) => {
    assert.throws(() => parseReleaseVersion(version))
  })

  it("requires an exact v-prefixed tag and manifest version", () => {
    assert.throws(() => versionFromTag("3.3.8"))
    assert.equal(validateReleaseManifest({ name: "esm-sync", version: "3.3.8" }, "v3.3.8"), "3.3.8")
    assert.throws(() => validateReleaseManifest({ name: "esm-sync", version: "3.3.7" }, "v3.3.8"))
    assert.throws(() => validateReleaseManifest({ name: "wrong", version: "3.3.8" }, "v3.3.8"))
  })

  it("compares stable versions numerically, including large integer components", () => {
    assert.equal(compareReleaseBases("3.10.0", "3.9.99"), 1)
    assert.equal(compareReleaseBases("3.3.8-beta.1", "3.3.8"), 0)
    assert.equal(compareReleaseBases("3.3.8", "4.0.0"), -1)
    assert.equal(compareReleaseBases("3.3.8", "3.3.8"), 0)
  })
})

describe("next numbered beta", () => {
  it.each([
    ["3.3.8", [], [], undefined, "3.3.8-beta.1"],
    ["3.3.8-beta.3", [], [], undefined, "3.3.8-beta.4"],
    ["3.3.8", ["3.3.8-beta.9", "3.4.0-beta.99"], ["v3.3.8-beta.12"], undefined, "3.3.8-beta.13"],
    ["3.3.8", [], ["v3.3.8-beta.9007199254740992"], undefined, "3.3.8-beta.9007199254740993"],
    ["3.3.7", ["3.3.7"], [], "3.3.8", "3.3.8-beta.1"],
    ["3.3.7", ["3.3.7", "3.4.0-beta.2"], ["v3.4.0-beta.4"], "v3.4.0", "3.4.0-beta.5"]
  ] as const)(
    "chooses next beta for %s with base %s",
    (current, published, tags, base, expected) => {
      assert.equal(nextBetaVersion(current, published, tags, base), expected)
    }
  )

  it("requires an explicit new base after the stable release was published", () => {
    assert.throws(() => nextBetaVersion("3.3.7", ["3.3.7"], []), /--base/)
    assert.throws(() => nextBetaVersion("3.3.7", [], ["v3.3.7"]), /--base/)
  })

  it("refuses an older, already released, or superseded base", () => {
    assert.throws(() => nextBetaVersion("3.4.0-beta.2", [], [], "3.3.8"), /earlier/)
    assert.throws(() => nextBetaVersion("3.3.7", ["3.3.8"], [], "3.3.8"), /released/)
    assert.throws(() => nextBetaVersion("3.3.7", ["3.4.0"], [], "3.3.8"), /newer/)
    assert.throws(() => nextBetaVersion("3.3.7", [], [], "3.3.8-beta.1"), /stable/)
  })
})
