import path from "node:path"
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import os from "node:os"
import { describe, it, expect } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

// Run in Node's actual interactive bootstrap so esm-sync installs its VM
// and REPL hooks. A preload fixture starts an isolated REPLServer and checks
// its behaviour through the public `repl` API rather than bundled internals.
const scenarios: Array<[string, string]> = [
  ["vm", "supports static imports through the REPL VM facade"],
  ["global", "supports global REPL contexts"],
  ["non-global", "supports non-global REPL contexts"],
  ["module-exports", "uses a plain object for module.exports"],
  ["json", "supports static and dynamic JSON imports"]
]

for (const esmEnv of testEnvironments) {
  describe(`REPL hook (${esmEnv})`, () => {
    it("runs the original #886 REPL and VM imports with disabled, cold and warm caches", async () => {
      const cache = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-vm-886 ü -")))
      const input = [
        'import test1 from ".";',
        "vm.runInThisContext(\"import test2 from '.';\");",
        'console.log("ESM_SYNC_VM_886", test1, test2)',
        ".exit",
        ""
      ].join("\n")
      try {
        for (const phase of ["disabled", "cold", "warm"]) {
          if (phase === "warm") expect((await readdir(cache)).length).toBeGreaterThan(0)
          const { exitCode, stdout, stderr } = await runNode(
            ["-r", path.resolve(testPath, "../index.js"), "-i"],
            esmEnv,
            {
              ESM_OPTIONS: JSON.stringify({
                cache: phase === "disabled" ? false : cache
              }),
              ESM_DISABLE_CACHE: phase === "disabled" ? "true" : "false"
            },
            { cwd: path.join(testPath, "fixture/vm-hook"), input }
          )
          expect(exitCode, phase + ": " + stderr).toBe(0)
          expect(stderr).toBe("")
          expect(stdout).not.toMatch(/Uncaught|SyntaxError|ReferenceError/)
          expect(stdout).toContain("ESM_SYNC_VM_886 test test")
          if (phase === "disabled") expect(await readdir(cache)).toEqual([])
        }
      } finally {
        await rm(cache, { recursive: true, force: true })
      }
    })
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

    it("supports the global REPL VM facade when the application starts its own REPL", async () => {
      const { exitCode, stdout, stderr } = await runNode(
        ["-r", "../index.js", "./fixture/repl-hook/driver.cjs"],
        esmEnv,
        { ESM_OPTIONS: "{cjs:false,mode:'auto'}", ESM_SYNC_REPL_CASE: "vm" },
        { cacheNamespace: "vm-hook-programmatic" }
      )
      expect(exitCode, stderr).toBe(0)
      expect(stderr).toBe("")
      expect(stdout).toContain("ESM_SYNC_REPL_OK:vm\n")
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
