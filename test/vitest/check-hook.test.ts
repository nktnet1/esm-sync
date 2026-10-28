import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it, expect } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

// Modern Node handles --check with its native syntax checker even when
// esm-sync is preloaded. Exercise the original CLI matrix with explicit ESM
// source types rather than relying on version-specific syntax detection.
const requireFlags = ["-r", "--require"]
const checkFlags = ["-c", "--check"]
const filenames = [
  "./fixture/check-hook/",
  "./fixture/check-hook/index.js",
  "./fixture/check-hook/index.mjs"
]
const source = readFileSync(path.join(testPath, "fixture/check-hook/index.js"), "utf8")
const invalidSource = "export const = 1\n"
const options = { ESM_OPTIONS: "{cjs:false,mode:'auto'}" }

for (const esmEnv of testEnvironments) {
  describe(`--check hook (${esmEnv})`, () => {
    for (const requireFlag of requireFlags) {
      for (const checkFlag of checkFlags) {
        for (const filename of filenames) {
          it(`accepts ${filename} with ${requireFlag} ${checkFlag}`, async () => {
            const { exitCode, stdout, stderr } = await runNode(
              [requireFlag, "../index.js", checkFlag, filename],
              esmEnv,
              options,
              { cacheNamespace: "check-hook" }
            )

            expect(exitCode, stderr).toBe(0)
            expect(stdout).toBe("")
            expect(stderr).toBe("")
          })
        }

        it(`rejects invalid syntax with ${requireFlag} ${checkFlag}`, async () => {
          const { exitCode, stdout, stderr } = await runNode(
            [requireFlag, "../index.js", checkFlag, "./fixture/check-hook/invalid.mjs"],
            esmEnv,
            options,
            { cacheNamespace: "check-hook" }
          )

          expect(exitCode, stderr).toBe(1)
          expect(stdout).toBe("")
          expect(stderr).toMatch(/SyntaxError/)
        })

        it(`accepts ESM stdin with ${requireFlag} ${checkFlag}`, async () => {
          // Modern Node's native --check treats stdin as CJS by default. The
          // explicit input type preserves the original ESM syntax coverage.
          const { exitCode, stdout, stderr } = await runNode(
            [requireFlag, "../index.js", "--input-type=module", checkFlag],
            esmEnv,
            options,
            { cacheNamespace: "check-hook", input: source }
          )

          expect(exitCode, stderr).toBe(0)
          expect(stdout).toBe("")
          expect(stderr).toBe("")
        })

        it(`rejects invalid ESM stdin with ${requireFlag} ${checkFlag}`, async () => {
          const { exitCode, stdout, stderr } = await runNode(
            [requireFlag, "../index.js", "--input-type=module", checkFlag],
            esmEnv,
            options,
            { cacheNamespace: "check-hook", input: invalidSource }
          )

          expect(exitCode, stderr).toBe(1)
          expect(stdout).toBe("")
          expect(stderr).toMatch(/SyntaxError/)
        })
      }
    }
  })
}
