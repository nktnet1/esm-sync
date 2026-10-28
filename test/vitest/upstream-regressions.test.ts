import assert from "node:assert/strict"
import { mkdir, mkdtemp, realpath, rm, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loaderOptions = { ESM_OPTIONS: "{cjs:true,mode:'auto'}" }
const loaderPath = path.resolve(testPath, "../esm.js")

async function withFiles(
  files: Record<string, string>,
  run: (directory: string) => Promise<void>
): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-upstream-")))
  try {
    for (const [name, contents] of Object.entries(files)) {
      const filename = path.join(directory, name)
      await mkdir(path.dirname(filename), { recursive: true })
      await writeFile(filename, contents)
    }
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function checkSuccess(result: Awaited<ReturnType<typeof runNode>>, output: string): void {
  assert.equal(result.exitCode, 0, result.stderr || result.stdout)
  assert.equal(result.stdout.trim(), output)
  assert.equal(result.stderr.trim(), "")
}

for (const esmEnv of testEnvironments) {
  describe(`resolved upstream regressions (${esmEnv})`, () => {
    // https://github.com/standard-things/esm/issues/926
    it("parses optional chaining when eval occurs in comments or strings", async () => {
      await withFiles(
        {
          "value.mjs": "export const value = 'ok'\n",
          "comment.js": `import { value } from './value.mjs'
const data = { answer: value } // eval appears in this comment
console.log('eval-comment:' + data?.answer)
`,
          "string.js": `import { value } from './value.mjs'
const text = 'eval'
const data = { answer: value }
console.log('eval-string:' + (text === 'eval' ? data?.answer : 'wrong'))
`
        },
        async (directory) => {
          for (const [filename, expected] of [
            ["comment.js", "eval-comment:ok"],
            ["string.js", "eval-string:ok"]
          ] as const) {
            checkSuccess(
              await runNode(
                ["-r", "../index.js", path.join(directory, filename)],
                esmEnv,
                loaderOptions,
                { cacheNamespace: "upstream-eval-token" }
              ),
              expected
            )
          }
        }
      )
    })

    // https://github.com/standard-things/esm/issues/918
    // https://github.com/standard-things/esm/issues/866
    it("executes optional chaining for missing and computed properties", async () => {
      await withFiles(
        {
          "optional.mjs": `const missing = null
const nested = { props: { answer: 42 } }
export const result = [missing?.answer, nested?.props?.['answer'], nested?.absent?.answer]
`
        },
        async (directory) => {
          const source = `const assert = require('node:assert/strict')
const load = require('../esm.js')(module)
assert.deepEqual(Array.from(load(process.argv[1]).result), [undefined, 42, undefined])
console.log('optional:ok')`
          checkSuccess(
            await runNode(
              ["-e", source, path.join(directory, "optional.mjs")],
              esmEnv,
              loaderOptions,
              {
                cacheNamespace: "upstream-optional"
              }
            ),
            "optional:ok"
          )
        }
      )
    })

    // https://github.com/standard-things/esm/issues/921
    it("loads functions containing optional chaining without calling them", async () => {
      await withFiles(
        {
          "plugin.js": `export function createQuery(params) {
  globalThis.__queryCalls++
  return params?.plugin_setup?.[params.propsP.fieldA]
}
`
        },
        async (directory) => {
          const source = `const assert = require('node:assert/strict')
globalThis.__queryCalls = 0
const load = require('../esm.js')(module)
const { createQuery } = load(process.argv[1])
assert.equal(globalThis.__queryCalls, 0)
assert.equal(createQuery({plugin_setup: {enabled: 42}, propsP: {fieldA: 'enabled'}}), 42)
assert.equal(globalThis.__queryCalls, 1)
console.log('query:ok')`
          checkSuccess(
            await runNode(
              ["-e", source, path.join(directory, "plugin.js")],
              esmEnv,
              loaderOptions,
              {
                cacheNamespace: "upstream-function-parse"
              }
            ),
            "query:ok"
          )
        }
      )
    })

    // https://github.com/standard-things/esm/issues/909
    // https://github.com/standard-things/esm/issues/879
    it("executes nullish coalescing in files containing imports", async () => {
      await withFiles(
        {
          "value.mjs": "export const value = 'ok'\n",
          "named.js": `import { value } from './value.mjs'
console.log('nullish-named:' + (undefined ?? value))
`,
          "builtin.js": `import http from 'node:http'
console.log('nullish-builtin:' + (null ?? (typeof http.request === 'function' ? 'ok' : 'bad')))
`
        },
        async (directory) => {
          for (const [filename, expected] of [
            ["named.js", "nullish-named:ok"],
            ["builtin.js", "nullish-builtin:ok"]
          ] as const) {
            checkSuccess(
              await runNode(
                ["-r", "../index.js", path.join(directory, filename)],
                esmEnv,
                loaderOptions,
                { cacheNamespace: "upstream-nullish-import" }
              ),
              expected
            )
          }
        }
      )
    })

    // https://github.com/standard-things/esm/issues/896
    // https://github.com/standard-things/esm/issues/914
    it("reports thrown module errors without printing the bundled loader source", async () => {
      await withFiles(
        { "failure.mjs": "throw new Error('upstream-error-marker')\n" },
        async (directory) => {
          const filename = path.join(directory, "failure.mjs")
          const result = await runNode(["-r", "../index.js", filename], esmEnv, loaderOptions, {
            cacheNamespace: "upstream-error-report"
          })
          assert.notEqual(result.exitCode, 0)
          assert.equal(result.stdout, "")
          assert.match(result.stderr, /Error: upstream-error-marker/)
          assert.ok(result.stderr.includes(filename), result.stderr)
          assert.ok(
            result.stderr.length < 12_000,
            `Unexpected error output: ${result.stderr.length} bytes`
          )
          assert.doesNotMatch(result.stderr, /const __global__ = this|var __shared__;const/)
        }
      )
    })

    // https://github.com/standard-things/esm/issues/931
    // https://github.com/standard-things/esm/issues/821
    it("loads filesystem built-ins without using removed Node internals", async () => {
      await withFiles(
        {
          "filesystem.mjs": `import fs from 'node:fs'
import { statSync } from 'node:fs'
const stats = statSync(new URL(import.meta.url))
if (!stats.isFile() || !fs.existsSync(new URL(import.meta.url))) throw new Error('bad fs stat')
console.log('filesystem:ok')
`
        },
        async (directory) => {
          checkSuccess(
            await runNode(
              ["-r", "../index.js", path.join(directory, "filesystem.mjs")],
              esmEnv,
              loaderOptions,
              { cacheNamespace: "upstream-fs-abi" }
            ),
            "filesystem:ok"
          )
        }
      )
    })

    // https://github.com/standard-things/esm/issues/855
    // https://github.com/standard-things/esm/issues/898
    // https://github.com/standard-things/esm/issues/868
    // https://github.com/standard-things/esm/issues/897
    // https://github.com/standard-things/esm/issues/900
    it('loads a "type": "module" package from CommonJS without warnings', async () => {
      await withFiles(
        {
          "package.json": '{"type":"module"}\n',
          "module.js": "export const X = 42\n",
          "main.cjs": `const load = require(${JSON.stringify(loaderPath)})(module)
console.log('package-type:' + load('./module.js').X)
`
        },
        async (directory) => {
          checkSuccess(
            await runNode([path.join(directory, "main.cjs")], esmEnv, loaderOptions, {
              cacheNamespace: "upstream-package-type"
            }),
            "package-type:42"
          )
        }
      )
    })

    // https://github.com/standard-things/esm/issues/816
    it("can initialise the loader more than once without redeclaring globals", async () => {
      await withFiles({ "value.mjs": "export const value = 42\n" }, async (directory) => {
        const source = `const assert = require('node:assert/strict')
const esm = require('../esm.js')
const first = esm(module)
const second = esm(module)
assert.equal(first(process.argv[1]).value, 42)
assert.equal(second(process.argv[1]).value, 42)
console.log('bootstrap-twice:ok')`
        checkSuccess(
          await runNode(["-e", source, path.join(directory, "value.mjs")], esmEnv, loaderOptions, {
            cacheNamespace: "upstream-repeat-loader"
          }),
          "bootstrap-twice:ok"
        )
      })
    })

    // https://github.com/standard-things/esm/issues/872
    it("exposes default-export instances through the namespace or cjs.dedefault", async () => {
      await withFiles(
        {
          "plugin.js": `class Plugin { activate() { return 'activated' } }
export default new Plugin()
`
        },
        async (directory) => {
          for (const dedefault of [false, true]) {
            const source = `const assert = require('node:assert/strict')
const load = require('../esm.js')(module, {mode:'auto',cjs:{dedefault:${dedefault}}})
const result = load(process.argv[1])
${dedefault ? "assert.equal(result.activate(), 'activated')" : "assert.equal(typeof result.activate, 'undefined'); assert.equal(result.default.activate(), 'activated')"}
console.log('dedefault:ok')`
            checkSuccess(
              await runNode(
                ["-e", source, path.join(directory, "plugin.js")],
                esmEnv,
                loaderOptions,
                {
                  cacheNamespace: `upstream-dedefault-${dedefault}`
                }
              ),
              "dedefault:ok"
            )
          }
        }
      )
    })

    // https://github.com/standard-things/esm/issues/813
    it("retains assigned properties when copying mixed CJS/ESM exports", async () => {
      await withFiles(
        {
          "options.js": "import fs from 'node:fs'\nmodule.exports = {}\n"
        },
        async (directory) => {
          const source = `const assert = require('node:assert/strict')
const load = require('../esm.js')(module)
const options = load(process.argv[1])
options.dev = true
assert.equal(options.dev, true)
assert.equal(Object.assign({}, options).dev, true)
console.log('mixed-assign:ok')`
          checkSuccess(
            await runNode(
              ["-e", source, path.join(directory, "options.js")],
              esmEnv,
              loaderOptions,
              {
                cacheNamespace: "upstream-object-assign"
              }
            ),
            "mixed-assign:ok"
          )
        }
      )
    })

    // https://github.com/standard-things/esm/issues/874
    it("invalidates the disk compiler cache when a dependency changes between runs", async () => {
      await withFiles(
        {
          "node_modules/upstream-cache-dependency/package.json":
            '{"name":"upstream-cache-dependency","main":"index.js"}\n',
          "node_modules/upstream-cache-dependency/index.js":
            "export { value } from './value.mjs'\n",
          "node_modules/upstream-cache-dependency/value.mjs": "export const value = 'before'\n"
        },
        async (directory) => {
          const filename = path.join(directory, "node_modules/upstream-cache-dependency/index.js")
          const dependency = path.join(
            directory,
            "node_modules/upstream-cache-dependency/value.mjs"
          )
          const source = `const load = require('../esm.js')(module)
console.log('cache-dependency:' + load(process.argv[1]).value)`
          const execute = () =>
            runNode(["-e", source, filename], esmEnv, loaderOptions, {
              cacheNamespace: "upstream-dependency-upgrade"
            })

          checkSuccess(await execute(), "cache-dependency:before")
          await writeFile(dependency, "export const value = 'after'\n")
          const current = await stat(dependency)
          const nextMtime = new Date(current.mtimeMs + 2_000)
          await utimes(dependency, nextMtime, nextMtime)
          checkSuccess(await execute(), "cache-dependency:after")
        }
      )
    })
  })
}
