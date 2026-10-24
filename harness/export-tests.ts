import type { DefaultFixture } from "./native-types.js"
const { describe, it } = globalThis.__esmSyncNativeTest
describe("export declaration tests", () => {
  it("should support star exports", () =>
    (import("./export/star.mjs" as string) as Promise<DefaultFixture>).then((ns) => ns.default()))
  it("should support circular star exports", () =>
    (import("./export/star-cycle.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should support specifiers that shadow `Object.prototype`", () =>
    (import("./export/shadowed.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should support all default syntax", () =>
    (import("./export/default.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should support all declaration syntax", () =>
    (import("./export/declarations.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should support all named export syntax", () =>
    (import("./export/named.mjs" as string) as Promise<DefaultFixture>).then((ns) => ns.default()))
  it("should support one-to-many renamed exports", () =>
    (import("./export/renamed.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should support all export-from syntax", () =>
    (import("./export/from.mjs" as string) as Promise<DefaultFixture>).then((ns) => ns.default()))
  it("should support destructuring syntax", () =>
    (import("./export/destructuring.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
})
