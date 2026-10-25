import type { DefaultFixture } from "./native-types.js"
const { describe, it } = globalThis.__esmSyncNativeTest
describe("require hook tests", () => {
  it("should be detectable", () =>
    (import("./require-hook/detectable.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should create an ESM loader", () =>
    (import("./require-hook/loader.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should load builtin modules", () =>
    (import("./require-hook/builtin-modules.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should support live binding through `module.exports`", () =>
    (import("./require-hook/live.js" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should support named exports", () =>
    (import("./require-hook/named-exports/index.js" as string) as Promise<DefaultFixture>).then(
      (ns) => ns.default()
    ))
  it("should support namespace exports", () =>
    (import("./require-hook/namespace.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should support `options.force`", () =>
    (import("./require-hook/force.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should support `options.mainFields`", () =>
    (import("./require-hook/main-fields/index.js" as string) as Promise<DefaultFixture>).then(
      (ns) => ns.default()
    ))
  it("should support `options.sourceMap`", () =>
    (import("./require-hook/source-map.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should support creating multiple loaders with different options", () =>
    (import("./require-hook/mixed.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
  it("should error for invalid options", () =>
    (import("./require-hook/invalid-options.mjs" as string) as Promise<DefaultFixture>).then((ns) =>
      ns.default()
    ))
})
