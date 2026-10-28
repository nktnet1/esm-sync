import Module from "node:module"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

const envAuto = { ESM_OPTIONS: "{cjs:true,mode:'auto'}" }
const fixturePath = fileURLToPath(new URL("../fixture/builtin-modules/", import.meta.url))

for (const esmEnv of testEnvironments) {
  describe(`built-in modules (${esmEnv})`, () => {
    it("inspects console values like native Node", async () => {
      const filename = `${fixturePath}console-inspect.js`
      const builtin = await runNode([filename], esmEnv)
      const loader = await runNode(
        ["-r", "../index.js", filename],
        esmEnv,
        {},
        {
          cacheNamespace: "builtin-modules-console"
        }
      )

      expect(builtin.exitCode, builtin.stderr).toBe(0)
      expect(loader.exitCode, loader.stderr).toBe(0)
      expect(loader.stdout).toBe(builtin.stdout)
    })

    it("does not expose non-enumerable built-in properties as exports", async () => {
      expect(Object.getOwnPropertyDescriptor(Module, "_stat")?.enumerable).toBe(false)

      const filename = `${fixturePath}non-enumerable.mjs`
      const { exitCode, stdout, stderr } = await runNode(
        ["-r", `${fixturePath}report-error.cjs`, "-r", "../index.js", filename],
        esmEnv,
        envAuto,
        { cacheNamespace: "builtin-modules-negative" }
      )

      const diagnostic =
        stderr.length > 8192
          ? `${stderr.slice(0, 4096)}\n[... truncated ...]\n${stderr.slice(-4096)}`
          : stderr
      const report = /^builtin-error:(.+)$/m.exec(stderr)

      expect(exitCode, diagnostic).toBe(1)
      expect.assert(report, diagnostic)
      expect(JSON.parse(report[1]!), diagnostic).toStrictEqual({
        name: "SyntaxError",
        message: "The requested module 'module' does not provide an export named '_stat'"
      })
      expect(stdout).toBe("")
    })

    it("exposes non-enumerable built-in properties with cjs.namedExports", async () => {
      expect(Object.getOwnPropertyDescriptor(Module, "_stat")?.enumerable).toBe(false)

      const filename = `${fixturePath}non-enumerable.js`
      const { exitCode, stdout, stderr } = await runNode(
        ["-r", "../index.js", filename],
        esmEnv,
        envAuto,
        { cacheNamespace: "builtin-modules-positive" }
      )

      expect(exitCode, stderr).toBe(0)
      expect(stderr.includes("does not provide an export")).toBe(false)
      expect(stdout.trim()).toBe("non-enumerable:true")
    })
  })
}
