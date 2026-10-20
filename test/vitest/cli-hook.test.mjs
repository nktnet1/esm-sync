import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.mjs"
const esmPaths = ["../", "../index.js", "../esm.js"]

for (const esmEnv of testEnvironments) {
  describe(`CLI hook (${esmEnv})`, () => {
    for (const request of esmPaths) {
      it(`does not fail on unresolvable arguments with ${request}`, async () => {
        const { exitCode, stderr } = await runNode(
          ["./node_modules/cli-hook-pass", "UNRESOLVABLE_VALUE", request],
          esmEnv,
          { ESM_OPTIONS: "{cjs:true,mode:'auto'}" }
        )

        assert.equal(exitCode, 0, stderr)
        assert.equal(stderr, "")
      })

      it(`inspects JSON-encoded arguments with ${request}`, async () => {
        const { exitCode, stdout, stderr } = await runNode(
          ["./node_modules/cli-hook-pass", JSON.stringify({ r: request })],
          esmEnv,
          { ESM_OPTIONS: "{cjs:true,mode:'auto'}" }
        )

        assert.equal(exitCode, 0, stderr)
        assert.ok(stdout.includes("cli-hook:true"), stdout)
      })

      it(`rejects .mjs sideloading with ${request}`, async () => {
        const { exitCode, stderr } = await runNode(
          ["./node_modules/cli-hook-fail", request],
          esmEnv
        )

        assert.equal(exitCode, 1, stderr)
        assert.match(stderr, /(?:^|\n)cli-hook-fail:ERR_REQUIRE_ESM(?:\n|$)/)
      })
    }
  })
}
