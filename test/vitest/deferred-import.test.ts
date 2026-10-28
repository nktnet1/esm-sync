import { describe, it, expect } from "vitest"
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
      expect(exitCode, stderr.slice(-4000)).toBe(0)
      expect(stdout.trim()).toBe("deferred-import:ok")
    })

    it("caches failed evaluation rather than treating subsequent reads as successful", async () => {
      const { exitCode, stdout, stderr } = await runNode(
        ["-r", "../index.js", "./fixture/deferred-import/error.mjs"],
        esmEnv,
        { ESM_OPTIONS: "{cjs:false,mode:'auto'}" },
        { cacheNamespace: "deferred-import-error" }
      )
      expect(exitCode, stderr.slice(-4000)).toBe(0)
      expect(stdout.trim()).toBe("deferred-error:ok")
    })
  })
}
