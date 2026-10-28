import { describe, it, expect } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"
const esmPaths = ["../", "../index.js", "../esm.js"]

for (const esmEnv of testEnvironments) {
  describe(`CLI hook (${esmEnv})`, () => {
    for (const request of esmPaths) {
      it(`does not fail on unresolvable arguments with ${request}`, async () => {
        const { exitCode, stderr } = await runNode(
          ["./node_modules/cli-hook-pass", "UNRESOLVABLE_VALUE", request],
          esmEnv,
          { ESM_OPTIONS: "{cjs:true,mode:'auto'}" },
          { cacheNamespace: "cli-hook" }
        )

        expect(exitCode, stderr).toBe(0)
        expect(stderr).toBe("")
      })

      it(`inspects JSON-encoded arguments with ${request}`, async () => {
        const { exitCode, stdout, stderr } = await runNode(
          ["./node_modules/cli-hook-pass", JSON.stringify({ r: request })],
          esmEnv,
          { ESM_OPTIONS: "{cjs:true,mode:'auto'}" },
          { cacheNamespace: "cli-hook" }
        )

        expect(exitCode, stderr).toBe(0)
        expect(stdout, stdout).toContain("cli-hook:true")
      })

      it(`rejects .mjs sideloading with ${request}`, async () => {
        const { exitCode, stderr } = await runNode(
          ["./node_modules/cli-hook-fail", request],
          esmEnv,
          {},
          { cacheNamespace: "cli-hook" }
        )

        expect(exitCode, stderr).toBe(1)
        expect(stderr).toMatch(/(?:^|\n)cli-hook-fail:ERR_REQUIRE_ESM(?:\n|$)/)
      })
    }
  })
}
