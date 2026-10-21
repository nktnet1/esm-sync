import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.mts"

const requireFlags = ["-r", "--require"]
const evalFlags = ["-e", "--eval"]
const printFlags = ["-p", "-pe", "--print"]
const loaderOptions = { ESM_OPTIONS: "{cjs:false,mode:'auto'}" }
const inlineModule = 'import { format } from "util"\nformat("print-hook:%s", true)'
const printedModule = 'require("../index.js")(module)("./fixture/eval-hook/print.mjs").default'

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
            loaderOptions,
            { cacheNamespace: "eval-hook" }
          )

          assert.equal(exitCode, 0, stderr)
          assert.equal(stderr, "")
          assert.ok(stdout.includes("eval-hook:true"), stdout)
        })
      }

      for (const printFlag of printFlags) {
        it(`prints an imported ESM value with ${requireFlag} and ${printFlag}`, async () => {
          const { exitCode, stdout, stderr } = await runNode(
            [requireFlag, "../index.js", printFlag, printedModule],
            esmEnv,
            loaderOptions,
            { cacheNamespace: "eval-hook" }
          )

          assert.equal(exitCode, 0, stderr)
          assert.equal(stderr, "")
          assert.equal(stdout, "print-hook:true\n")
        })

        it(`preserves Node's inline ESM ${printFlag} restriction with ${requireFlag}`, async () => {
          // Node >=22 rejects inline ESM source with --print before the
          // preloaded loader can transform it. Keep the original input under
          // test instead of silently replacing its import with require().
          const { exitCode, stdout, stderr } = await runNode(
            [requireFlag, "../index.js", printFlag, inlineModule],
            esmEnv,
            loaderOptions,
            { cacheNamespace: "eval-hook" }
          )

          assert.equal(exitCode, 1, stderr)
          assert.equal(stdout, "")
          assert.match(stderr, /ERR_EVAL_ESM_CANNOT_PRINT/)
        })
      }
    }
  })
}
