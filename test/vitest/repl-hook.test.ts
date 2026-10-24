import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

// Run in Node's actual interactive bootstrap so esm-sync installs its VM
// and REPL hooks. A preload fixture starts an isolated REPLServer and checks
// its behaviour through the public `repl` API rather than bundled internals.
const scenarios: Array<[string, string]> = [
  ["global", "supports global REPL contexts"],
  ["non-global", "supports non-global REPL contexts"],
  ["module-exports", "uses a plain object for module.exports"],
  ["json", "supports static and dynamic JSON imports"]
]

for (const esmEnv of testEnvironments) {
  describe(`REPL hook (${esmEnv})`, () => {
    it("recovers after an invalid import at the interactive prompt", async () => {
      const input = [
        'import { NOT_EXPORTED } from "path"',
        'import { join } from "path"',
        'console.log("ESM_SYNC_REPL_OK:error-recovery", join("parent", "child"))',
        ".exit",
        ""
      ].join("\n")

      const { exitCode, stdout, stderr } = await runNode(
        ["-r", "../index.js", "-i"],
        esmEnv,
        { ESM_OPTIONS: "{cjs:false,mode:'auto'}" },
        { cacheNamespace: "repl-hook", input }
      )

      assert.equal(exitCode, 0, stderr)
      assert.equal(stderr, "")
      assert.match(stdout, /does not provide an export named 'NOT_EXPORTED'/)
      assert.ok(
        stdout.includes(`ESM_SYNC_REPL_OK:error-recovery ${path.join("parent", "child")}`),
        stdout
      )
    })

    for (const [scenario, description] of scenarios) {
      it(description, async () => {
        const { exitCode, stdout, stderr } = await runNode(
          ["-r", "../index.js", "-r", "./fixture/repl-hook/driver.cjs", "-i"],
          esmEnv,
          {
            ESM_OPTIONS: "{cjs:false,mode:'auto'}",
            ESM_SYNC_REPL_CASE: scenario
          },
          { cacheNamespace: "repl-hook", keepStdinOpen: true }
        )

        assert.equal(exitCode, 0, stderr)
        assert.equal(stderr, "")
        assert.ok(stdout.includes(`ESM_SYNC_REPL_OK:${scenario}\n`), stdout)
      })
    }
  })
}
