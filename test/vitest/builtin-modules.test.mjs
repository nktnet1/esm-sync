import assert from "node:assert/strict"
import Module from "node:module"
import { fileURLToPath } from "node:url"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.mts"

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

      assert.equal(builtin.exitCode, 0, builtin.stderr)
      assert.equal(loader.exitCode, 0, loader.stderr)
      assert.equal(loader.stdout, builtin.stdout)
    })

    it("does not expose non-enumerable built-in properties as exports", async () => {
      assert.equal(Object.getOwnPropertyDescriptor(Module, "_stat")?.enumerable, false)

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

      assert.equal(exitCode, 1, diagnostic)
      assert.ok(report, diagnostic)
      assert.deepEqual(
        JSON.parse(report[1]),
        {
          name: "SyntaxError",
          message: "The requested module 'module' does not provide an export named '_stat'"
        },
        diagnostic
      )
      assert.equal(stdout, "")
    })

    it("exposes non-enumerable built-in properties with cjs.namedExports", async () => {
      assert.equal(Object.getOwnPropertyDescriptor(Module, "_stat")?.enumerable, false)

      const filename = `${fixturePath}non-enumerable.js`
      const { exitCode, stdout, stderr } = await runNode(
        ["-r", "../index.js", filename],
        esmEnv,
        envAuto,
        { cacheNamespace: "builtin-modules-positive" }
      )

      assert.equal(exitCode, 0, stderr)
      assert.equal(stderr.includes("does not provide an export"), false)
      assert.equal(stdout.trim(), "non-enumerable:true")
    })
  })
}
