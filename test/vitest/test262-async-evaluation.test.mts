import assert from "node:assert/strict"
import { createRequire } from "node:module"
import path from "node:path"
import execa from "execa"
import { describe, it } from "vitest"
import { nodeEnv, testEnvironments, testPath } from "./helpers/run-node.mts"

const require = createRequire(import.meta.url)
const { assertTest262Outcome } = require("../../script/test262-outcome.js") as {
  assertTest262Outcome: (filename: string, stdout: string) => void
}
const wrapperDirectory = path.join(testPath, "test262")
const corpusDirectory = path.join(
  testPath,
  "vendor/test262/test/language/module-code/top-level-await"
)
const cases = [
  ["async-module-does-not-block-sibling-modules.js", true],
  ["await-awaits-thenables-that-throw.js", true],
  ["dfs-invariant.js", false],
  ["dynamic-import-rejection.js", true],
  ["fulfillment-order.js", true],
  ["module-graphs-does-not-hang.js", true],
  ["module-import-resolution.js", true],
  ["pending-async-dep-from-cycle.js", true],
  ["rejection-order.js", true],
  ["unobservable-global-async-evaluation-count-reset.js", true],
  ...[
    "array-literal",
    "func-expression",
    "identifier",
    "literal-number",
    "literal-string",
    "nested",
    "new-expr",
    "null",
    "obj-literal",
    "regexp",
    "template-literal",
    "this"
  ].map((name) => [`syntax/for-await-await-expr-${name}.js`, false] as const)
] as const

for (const esmEnv of testEnvironments) {
  describe(`pinned Test262 async evaluation (${esmEnv})`, () => {
    for (const [name, async] of cases) {
      it(name, async () => {
        const filename = path.join(corpusDirectory, name)
        const cache = esmEnv.endsWith("-cached")
          ? path.join(testPath, "env/native-cache", esmEnv, "test262-async", name)
          : false
        const { exitCode, stdout, stderr, timedOut } = await execa(
          process.execPath,
          [
            "--harmony",
            "--experimental-vm-modules",
            "--disable-warning=ExperimentalWarning",
            "-r",
            "../../",
            path.join(wrapperDirectory, "wrapper.js"),
            filename,
            String(async),
            '["compareArray.js"]',
            "true"
          ],
          {
            cwd: wrapperDirectory,
            env: {
              ...process.env,
              NODE_ENV: nodeEnv,
              ESM_ENV: esmEnv,
              ESM_OPTIONS: JSON.stringify({ cjs: false, cache, mode: "all" })
            },
            reject: false,
            timeout: 20_000
          }
        )
        assert.equal(timedOut, false, name)
        assert.equal(exitCode, 0, stderr || stdout)
        assert.equal(stderr, "", name)
        assertTest262Outcome(filename, stdout)
      })
    }
  })
}
