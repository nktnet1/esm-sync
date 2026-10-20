import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import SemVer from "semver"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.mts"

const canTestFsPromises = SemVer.satisfies(process.version, ">=10 <11.14")
const envAuto = { ESM_OPTIONS: "{cjs:true,mode:'auto'}" }
const fixturePath = fileURLToPath(new URL("../fixture/builtin-modules/", import.meta.url))

for (const esmEnv of testEnvironments) {
  describe(`built-in modules (${esmEnv})`, () => {
    it("inspects console values like native Node", async () => {
      const filename = `${fixturePath}console-inspect.js`
      const builtin = await runNode([filename], esmEnv)
      const loader = await runNode(["-r", "../index.js", filename], esmEnv)

      assert.equal(builtin.exitCode, 0, builtin.stderr)
      assert.equal(loader.exitCode, 0, loader.stderr)
      assert.equal(loader.stdout, builtin.stdout)
    })

    it.skipIf(!canTestFsPromises)(
      "does not expose non-enumerable built-in properties as exports",
      async () => {
        const filename = `${fixturePath}non-enumerable.mjs`
        const { exitCode, stdout, stderr } = await runNode(
          ["-r", "../index.js", filename],
          esmEnv,
          envAuto
        )

        assert.notEqual(exitCode, 0, "Expected named import to fail")
        assert.ok(stderr.includes("does not provide an export"), stderr)
        assert.equal(stdout, "")
      }
    )

    it.skipIf(!canTestFsPromises)(
      "exposes non-enumerable built-in properties with cjs.namedExports",
      async () => {
        const filename = `${fixturePath}non-enumerable.js`
        const { exitCode, stdout, stderr } = await runNode(
          ["-r", "../index.js", filename],
          esmEnv,
          envAuto
        )

        assert.equal(exitCode, 0, stderr)
        assert.equal(stderr.includes("does not provide an export"), false)
        assert.ok(stdout.includes("non-enumerable:true"), stdout)
      }
    )
  })
}
