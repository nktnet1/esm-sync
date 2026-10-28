import { describe, it, expect } from "vitest"
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
      expect(result.exitCode, result.stderr.slice(-4000)).toBe(0)
      expect(result.stdout.trim()).toBe("source-imports:pass")
    })

    it("imports immutable bytes on capable hosts and rejects explicitly on other hosts", async () => {
      const result = await runNode(
        ["--harmony", "-r", "../index.js", "./fixture/value-imports/bytes-host.mjs"],
        esmEnv,
        { ESM_OPTIONS: "{cjs:false,mode:'auto'}" },
        { cacheNamespace: "bytes-imports" }
      )
      expect(result.exitCode, result.stderr.slice(-4000)).toBe(0)
      expect(result.stdout.trim()).toMatch(/^bytes-imports:(?:pass|unsupported-host)$/)
    })
  })
}
