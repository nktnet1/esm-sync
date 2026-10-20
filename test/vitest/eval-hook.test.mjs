import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.mts"

const requireFlags = ["-r", "--require"]
const evalFlags = ["-e", "--eval"]
const printFlags = ["-p", "-pe", "--print"]
const loaderOptions = { ESM_OPTIONS: "{cjs:false,mode:'auto'}" }

for (const esmEnv of testEnvironments) {
  describe(`eval hook (${esmEnv})`, () => {
    for (const requireFlag of requireFlags) {
      for (const evalFlag of evalFlags) {
        it(`supports ${requireFlag} with ${evalFlag}`, async () => {
          const { exitCode, stdout, stderr } = await runNode(
            [
              requireFlag,
              "../index.js",
              evalFlag,
              'import { log } from "console"\n\nlog("eval-hook:true")'
            ],
            esmEnv,
            loaderOptions
          )

          assert.equal(exitCode, 0, stderr)
          assert.equal(stderr, "")
          assert.ok(stdout.includes("eval-hook:true"), stdout)
        })
      }

      for (const printFlag of printFlags) {
        it(`supports ${requireFlag} with ${printFlag}`, async () => {
          const { exitCode, stdout, stderr } = await runNode(
            [
              requireFlag,
              "../index.js",
              printFlag,
              'const { format } = require("util")\nformat("print-hook:%s", true)'
            ],
            esmEnv,
            loaderOptions
          )

          assert.equal(exitCode, 0, stderr)
          assert.equal(stderr, "")
          assert.ok(stdout.includes("print-hook:true"), stdout)
        })
      }
    }
  })
}
