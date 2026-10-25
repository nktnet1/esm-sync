import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

for (const esmEnv of testEnvironments) {
  describe(`deferred imports (${esmEnv})`, () => {
    it("evaluates once on export access, not namespace inspection", async () => {
      const { exitCode, stdout, stderr } = await runNode(
        ["-r", "../index.js", "./fixture/deferred-import/index.mjs"],
        esmEnv,
        { ESM_OPTIONS: "{cjs:false,mode:'auto'}" },
        { cacheNamespace: "deferred-import" }
      )
      assert.equal(exitCode, 0, stderr.slice(-4000))
      assert.equal(stdout.trim(), "deferred-import:ok")
    })

    it("caches failed evaluation rather than treating subsequent reads as successful", async () => {
      const { exitCode, stdout, stderr } = await runNode(
        ["-r", "../index.js", "./fixture/deferred-import/error.mjs"],
        esmEnv,
        { ESM_OPTIONS: "{cjs:false,mode:'auto'}" },
        { cacheNamespace: "deferred-import-error" }
      )
      assert.equal(exitCode, 0, stderr.slice(-4000))
      assert.equal(stdout.trim(), "deferred-error:ok")
    })
  })
}
