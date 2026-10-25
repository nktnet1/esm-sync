import type { DefaultFixture } from "./native-types.js"
const { describe, it } = globalThis.__esmSyncNativeTest
import SemVer from "semver"
const canTestWASM = SemVer.satisfies(process.version, ">=8")
describe("wasm tests", { skip: !canTestWASM }, () => {
  it("should support `options.wasm`", () =>
    (import("./wasm/import.js" as string) as Promise<DefaultFixture>).then((ns) => ns.default()))
  it("should hoist declarations before evaluation", () =>
    (import("./wasm/hoist-declarations.js" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
})
