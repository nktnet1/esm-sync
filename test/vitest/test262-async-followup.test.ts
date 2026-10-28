import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import execa from "execa"
import { describe, it, expect } from "vitest"
import { nodeEnv, testEnvironments, testPath } from "./helpers/run-node.ts"

const require = createRequire(import.meta.url)
const { parseFile } = require("test262-parser") as {
  parseFile(source: string): {
    attrs: { flags: Partial<Record<"module" | "async", boolean>>; includes?: string[] }
  }
}
const { assertTest262Outcome } = require("../../dist/script/test262-outcome.js") as {
  assertTest262Outcome(filename: string, stdout: string): void
}
const cases = [
  ...[
    "import-defer-async-module/main.js",
    "import-defer-transitive-async-module/main.js",
    "import-defer-transitive-async-module/promise-prototype-then-not-called.js",
    "sync-dependency-of-deferred-async-module/main.js"
  ].map((name) => `expressions/dynamic-import/import-defer/${name}`),
  "expressions/dynamic-import/import-fulfilled-member-of-errored-cycle.js",
  "module-code/top-level-await/dynamic-import-of-waiting-module.js",
  ...["", "-agen", "-agen-yield"].map(
    (name) => `expressions/dynamic-import/for-await-resolution-and-error${name}.js`
  ),
  "expressions/dynamic-import/import-attributes/2nd-param-with-type-text.js",
  ...[
    "errors/get-other-while-dep-evaluating-async/main.js",
    "errors/get-self-while-evaluating-async/main.js",
    "evaluation-top-level-await/async-cycle-dependency-of-deferred-module/main.js",
    "evaluation-top-level-await/flattening-order/main.js",
    "evaluation-top-level-await/import-defer-async-module/main.js",
    "evaluation-top-level-await/import-defer-transitive-async-module/main.js",
    "evaluation-top-level-await/sync-dependency-of-deferred-async-module/main.js"
  ].map((name) => `import/import-defer/${name}`),
  ...["Symbol.dispose", "Symbol.asyncDispose"].flatMap((symbol) => [
    `statements/await-using/initializer-${symbol}-disposed-at-end-of-imported-module.js`,
    `statements/await-using/initializer-${symbol}-disposed-at-end-of-module.js`
  ]),
  "statements/await-using/syntax/await-using-allowed-at-top-level-of-module.js",
  "statements/await-using/syntax/await-using.js",
  "statements/using/initializer-disposed-at-end-of-imported-module.js",
  "statements/using/initializer-disposed-at-end-of-module.js",
  "statements/using/syntax/using-allowed-at-top-level-of-module.js",
  "statements/using/syntax/using.js"
]

for (const esmEnv of testEnvironments) {
  describe(`pinned Test262 async follow-up (${esmEnv})`, () => {
    for (const name of cases) {
      it(name, async () => {
        const filename = path.join(testPath, "vendor/test262/test/language", name)
        const { attrs } = parseFile(await readFile(filename, "utf8"))
        const cached = esmEnv.endsWith("-cached")
        const cache = cached
          ? path.join(testPath, "env/native-cache", esmEnv, "test262-followup", name)
          : false
        for (let pass = 0; pass < (cached ? 2 : 1); pass++) {
          const { exitCode, stdout, stderr, timedOut } = await execa(
            process.execPath,
            [
              "--harmony",
              "--experimental-vm-modules",
              "--disable-warning=ExperimentalWarning",
              "-r",
              "../../",
              "wrapper.js",
              filename,
              String(Boolean(attrs.flags.async)),
              JSON.stringify(attrs.includes || []),
              String(Boolean(attrs.flags.module))
            ],
            {
              cwd: path.join(testPath, "test262"),
              env: {
                ...process.env,
                NODE_ENV: nodeEnv,
                ESM_ENV: esmEnv,
                ESM_OPTIONS: JSON.stringify({
                  cjs: false,
                  cache,
                  mode: "all"
                })
              },
              reject: false,
              timeout: 20_000
            }
          )
          expect(timedOut, name).toBe(false)
          expect(exitCode, stderr || stdout).toBe(0)
          expect(stderr, name).toBe("")
          assertTest262Outcome(filename, stdout)
        }
      }, 60_000)
    }
  })
}
