import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

for (const esmEnv of testEnvironments) {
  describe(`source and bytes imports (${esmEnv})`, () => {
    it("caches branded module sources without resolving or evaluating their dependencies", async () => {
      const result = await runNode(
        ["-r", "../index.js", "./fixture/value-imports/source.mjs"],
        esmEnv,
        { ESM_OPTIONS: "{cjs:false,mode:'auto'}" },
        { cacheNamespace: "source-imports" }
      )
      assert.equal(result.exitCode, 0, result.stderr.slice(-4000))
      assert.equal(result.stdout.trim(), "source-imports:pass")
    })

    it("imports immutable bytes on capable hosts and rejects explicitly on other hosts", async () => {
      const result = await runNode(
        ["--harmony", "-r", "../index.js", "./fixture/value-imports/bytes-host.mjs"],
        esmEnv,
        { ESM_OPTIONS: "{cjs:false,mode:'auto'}" },
        { cacheNamespace: "bytes-imports" }
      )
      assert.equal(result.exitCode, 0, result.stderr.slice(-4000))
      assert.match(result.stdout.trim(), /^bytes-imports:(?:pass|unsupported-host)$/)
    })
  })
}
