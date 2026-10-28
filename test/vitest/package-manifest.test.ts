import { describe, it, expect } from "vitest"
import { createPublishManifest } from "../../script/src/package-manifest.ts"

describe("published package manifest", () => {
  it("retains native installation hooks while removing development commands and metadata", () => {
    const source = {
      name: "esm-sync",
      version: "3.3.7",
      main: "esm.js",
      dependencies: { punycode: "^2.3.1" },
      private: false,
      esm: true,
      devDependencies: { typescript: "^6.0.3" },
      scripts: {
        preinstall: "prepare native bridge",
        install: "build native bridge",
        postinstall: "verify native bridge",
        build: "build workspace",
        prepublishOnly: "requires development sources"
      }
    }
    const published = createPublishManifest(source)
    expect(published.scripts).toStrictEqual({
      test: 'echo "Error: no test specified" && exit 1',
      preinstall: source.scripts.preinstall,
      install: source.scripts.install,
      postinstall: source.scripts.postinstall
    })
    expect(published.dependencies).toStrictEqual(source.dependencies)
    expect(published.main).toBe(source.main)
    for (const key of ["private", "esm", "devDependencies"])
      expect(published).not.toHaveProperty(key)
    expect(source.scripts.build).toBe("build workspace")
    expect(source).toHaveProperty("devDependencies")
  })

  it("can prepare a manifest without installation scripts", () => {
    expect(createPublishManifest({ name: "esm-sync" }).scripts).toStrictEqual({
      test: 'echo "Error: no test specified" && exit 1'
    })
  })
})
