import assert from "node:assert/strict"
import { describe, it } from "vitest"
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
    assert.deepEqual(published.scripts, {
      test: 'echo "Error: no test specified" && exit 1',
      preinstall: source.scripts.preinstall,
      install: source.scripts.install,
      postinstall: source.scripts.postinstall
    })
    assert.deepEqual(published.dependencies, source.dependencies)
    assert.equal(published.main, source.main)
    for (const key of ["private", "esm", "devDependencies"]) assert.ok(!(key in published))
    assert.equal(source.scripts.build, "build workspace")
    assert.ok("devDependencies" in source)
  })

  it("can prepare a manifest without installation scripts", () => {
    assert.deepEqual(createPublishManifest({ name: "esm-sync" }).scripts, {
      test: 'echo "Error: no test specified" && exit 1'
    })
  })
})
