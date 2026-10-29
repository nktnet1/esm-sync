import path from "node:path"
import { describe, it, expect } from "vitest"
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

      expect(exitCode, stderr).toBe(0)
      expect(stderr).toBe("")
      expect(stdout).toMatch(/does not provide an export named 'NOT_EXPORTED'/)
      expect(stdout, stdout).toContain(
        `ESM_SYNC_REPL_OK:error-recovery ${path.join("parent", "child")}`
      )
    })

    it("supports static imports in a programmatically started REPL", async () => {
      const { exitCode, stdout, stderr } = await runNode(
        ["-r", "../index.js", "./fixture/repl-hook/driver.cjs"],
        esmEnv,
        {
          ESM_OPTIONS: "{cjs:false,mode:'auto'}",
          ESM_SYNC_REPL_CASE: "custom"
        },
        { cacheNamespace: "repl-hook" }
      )

      expect(exitCode, stderr).toBe(0)
      expect(stderr).toBe("")
      expect(stdout, stdout).toContain("ESM_SYNC_REPL_OK:custom\n")
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

        expect(exitCode, stderr).toBe(0)
        expect(stderr).toBe("")
        expect(stdout, stdout).toContain(`ESM_SYNC_REPL_OK:${scenario}\n`)
      })
    }
  })
}
