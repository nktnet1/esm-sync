import type { DefaultFixture } from "./native-types.js"
const { describe, it } = globalThis.__esmSyncNativeTest
describe("setter tests", () => {
  it("should run setters after eval(...)", () =>
    (import("./setter/eval.mjs" as string) as Promise<DefaultFixture>).then((ns) => ns.default()))
  it("should run setters for untouched CJS modules", () =>
    (import("./setter/untouched/index.js" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should run setters when children update exports", () =>
    (import("./setter/children.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should not prematurely seal star exports", () =>
    (import("./setter/seal/index.js" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
})
