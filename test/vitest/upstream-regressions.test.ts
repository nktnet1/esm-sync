import { mkdir, mkdtemp, realpath, rm, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, it, type TestContext } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"
import {
  coverageFor,
  runCoverage,
  tsNodeRegister,
  mochaCLI,
  proxyquirePath
} from "./helpers/coverage.ts"

const loaderOptions = { ESM_OPTIONS: "{cjs:true,mode:'auto'}" }
const loaderPath = path.resolve(testPath, "../esm.js")
const coverageTestTimeout = 180_000

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

function checkSuccess(
  expect: TestContext["expect"],
  result: Awaited<ReturnType<typeof runNode>>,
  output: string
): void {
  expect(result.exitCode, result.stderr || result.stdout).toBe(0)
  expect(result.stdout.trim()).toBe(output)
  expect(result.stderr.trim()).toBe("")
}

// Each case owns its fixtures and cache namespace. Only independent cases
// overlap; repeated processes within a case still run in their original order.
for (const esmEnv of testEnvironments) {
  describe.concurrent(`resolved upstream regressions (${esmEnv})`, () => {
    // https://github.com/standard-things/esm/issues/817
    // A failed dlopen should reject the import Promise. This tests only the
    // Node runtime, not Electron's renderer or mismatched addon ABI handling.
    it("rejects a malformed native addon from dynamic import", async (context) => {
      const expect: TestContext["expect"] = context.expect
      await withFiles(
        {
          "invalid.node": "not an addon\n",
          "entry.js": `import('./invalid.node').then(
  () => console.log('unexpected success'),
  (error) => console.log(error.code)
)\n`
        },
        async (directory) => {
          const result = await runNode(["-r", loaderPath, "entry.js"], esmEnv, loaderOptions, {
            cwd: directory
          })
          checkSuccess(expect, result, "ERR_DLOPEN_FAILED")
        }
      )
    })

    // https://github.com/standard-things/esm/issues/910
    it(
      "collects real NYC counters after an ordinary run has warmed the compiler cache",
      async (context) => {
        const expect: TestContext["expect"] = context.expect
        await withFiles(
          {
            "math.js":
              "export function covered() { return 42 }\nexport function unused() { return 0 }\n",
            "index.js": "import { covered } from './math.js'; console.log(covered())\n"
          },
          async (directory) => {
            const options = { ESM_OPTIONS: "{cjs:true,mode:'auto',cache:'./esm-cache'}" }
            checkSuccess(
              expect,
              await runNode(["-r", loaderPath, "index.js"], esmEnv, options, { cwd: directory }),
              "42"
            )
            const result = await runCoverage(directory, esmEnv)
            expect(result.exitCode, result.stderr).toBe(0)
            const file = await coverageFor(result.coverage, path.join(directory, "math.js"))
            expect.assert(file, "NYC must see the source instead of reusing uninstrumented output")
            expect(Object.values(file.f).sort()).toStrictEqual([0, 1])
          }
        )
      },
      coverageTestTimeout
    )

    // https://github.com/standard-things/esm/issues/852
    it(
      "calls the exported calc function through NYC, Mocha, ts-node, and the loader",
      async (context) => {
        const expect: TestContext["expect"] = context.expect
        await withFiles(
          {
            "calc.ts": "export const calc = (a: number, b: number): number => a + b\n",
            "calc.test.ts":
              "import { strictEqual } from 'node:assert'\nimport { calc } from './calc'\ndescribe('calc', () => it('adds', () => strictEqual(calc(1, 2), 3)))\n"
          },
          async (directory) => {
            const result = await runCoverage(directory, esmEnv, {
              entry: mochaCLI,
              include: "calc.ts",
              preloads: [tsNodeRegister, loaderPath],
              args: ["--reporter=dot", "calc.test.ts"],
              env: {
                TS_NODE_SKIP_PROJECT: "true",
                TS_NODE_TRANSPILE_ONLY: "true",
                TS_NODE_COMPILER_OPTIONS: JSON.stringify({
                  module: "ESNext",
                  moduleResolution: "Bundler",
                  target: "ES2022"
                })
              }
            })
            expect(result.exitCode, result.stderr || result.stdout).toBe(0)
            const file = await coverageFor(result.coverage, path.join(directory, "calc.ts"))
            expect.assert(file)
            expect(Object.values(file.f)).toStrictEqual([1])
          }
        )
      },
      coverageTestTimeout
    )

    // https://github.com/standard-things/esm/issues/839
    it(
      "starts and instruments the .mjs entry supplied to nyc --require esm",
      async (context) => {
        const expect: TestContext["expect"] = context.expect
        await withFiles(
          {
            "ok.mjs":
              "import { strictEqual } from 'node:assert'; strictEqual(1 + 1, 2); console.log('ok')\n"
          },
          async (directory) => {
            const result = await runCoverage(directory, esmEnv, {
              entry: "ok.mjs",
              include: "ok.mjs"
            })
            expect(result.exitCode, result.stderr).toBe(0)
            expect(result.stdout).toBe("ok\n")
            const file = await coverageFor(result.coverage, path.join(directory, "ok.mjs"))
            expect.assert(file)
            expect(Object.values(file.s).some((count) => count > 0)).toBe(true)
          }
        )
      },
      coverageTestTimeout
    )

    // https://github.com/standard-things/esm/issues/805
    it("lets a later C mock replace the parsed B-to-C re-export after an A-to-B mock", async ({
      expect
    }) => {
      await withFiles(
        {
          "A.js": "import B from './B.js'; export default B\n",
          "B.js": "import C from './C.js'; export default C\n",
          "C.js": "export default 42\n",
          // Exercise rewiremock's Module._load/cache protocol without adding
          // a dependency on an unavailable historical rewiremock release.
          "index.cjs": `const Module = require('module')
const original = Module._load
Module._load = function(request) { return request === './B.js' ? 'bar' : original.apply(this, arguments) }
const first = require('./A.js').default
for (const name of ['A', 'B', 'C']) delete require.cache[require.resolve('./' + name + '.js')]
Module._load = function(request) { return request === './C.js' ? { __esModule: true, default: 'baz' } : original.apply(this, arguments) }
const second = require('./B.js').default
Module._load = original
console.log(JSON.stringify([first, second]))
`
        },
        async (directory) =>
          checkSuccess(
            expect,
            await runNode(["-r", loaderPath, "index.cjs"], esmEnv, loaderOptions, {
              cwd: directory
            }),
            '["bar","baz"]'
          )
      )
    })

    // https://github.com/standard-things/esm/issues/798
    it("preserves proxyquire's global path stub when c.js has an unused named path import", async ({
      expect
    }) => {
      await withFiles(
        {
          "a.js":
            "import b from './b.js'; import { extname } from 'path'; export default () => 'a' + b + extname('')\n",
          "b.js": "",
          "c.js":
            "import a from './a.js'; import { extname } from 'path'; export default () => a()\n",
          "index.cjs": `const proxyquire = require(${JSON.stringify(proxyquirePath)})
const a = proxyquire.load('./a.js', { path: { extname: () => 'c' }, './b.js': 'b' })
const first = a.default()
const b = new String('b'); b['@global'] = true
const c = proxyquire.load('./c.js', { path: { extname: () => 'c', '@global': true }, './b.js': b })
console.log(JSON.stringify([first, c.default()]))
`
        },
        async (directory) =>
          checkSuccess(
            expect,
            await runNode(["-r", loaderPath, "index.cjs"], esmEnv, loaderOptions, {
              cwd: directory
            }),
            '["abc","abc"]'
          )
      )
    })

    // https://github.com/standard-things/esm/issues/786
    it("keeps internal .mjs imports outside the documented CommonJS mocking boundary", async ({
      expect
    }) => {
      await withFiles(
        {
          "foo.mjs": "export default () => 'FOO'\n",
          "index.mjs": "import foo from './foo.mjs'; export default () => foo()\n",
          "index.cjs": `const load = require(${JSON.stringify(loaderPath)})(module, { cjs: true, mode: 'auto' })
const Module = load('module')
const original = Module._load
Module._load = function(request) { return request === './foo.mjs' ? () => 'bar' : original.apply(this, arguments) }
try { console.log(load('./index.mjs').default()) } finally { Module._load = original }
`
        },
        async (directory) =>
          checkSuccess(expect, await runNode(["index.cjs"], esmEnv, {}, { cwd: directory }), "FOO")
      )
    })

    // https://github.com/standard-things/esm/issues/916
    it("treats cache:false and ESM_DISABLE_CACHE as compiler settings rather than module reload requests", async ({
      expect
    }) => {
      await withFiles(
        {
          "config.js": "export default 'before'\n",
          "index.cjs": `process.env.ESM_DISABLE_CACHE = 'true'
const load = require(${JSON.stringify(loaderPath)})(module, { cache: false, cjs: { cache: false }, force: true })
const first = load('./config.js').default
require('node:fs').writeFileSync('./config.js', "export default 'after'\\n")
console.log(JSON.stringify([first, load('./config.js').default]))
`
        },
        async (directory) =>
          checkSuccess(
            expect,
            await runNode(["index.cjs"], esmEnv, {}, { cwd: directory }),
            '["before","before"]'
          )
      )
    })

    // https://github.com/standard-things/esm/issues/812
    it("imports a morgan-style CommonJS function without reading its deprecated default property", async ({
      expect
    }) => {
      await withFiles(
        {
          // Match morgan's legacy API without depending on a particular release.
          "morgan.cjs": `function morgan(format) { return format }
Object.defineProperty(morgan, 'default', {
  enumerable: true,
  configurable: true,
  get: require('node:util').deprecate(() => 'combined', 'default format: use combined format')
})
module.exports = morgan
`,
          "index.js":
            "import morgan, * as ns from './morgan.cjs'; console.log(ns.default === morgan && morgan('combined'))\n"
        },
        async (directory) => {
          checkSuccess(
            expect,
            await runNode(["-r", loaderPath, "index.js"], esmEnv, loaderOptions, {
              cwd: directory
            }),
            "combined"
          )
        }
      )
    })

    // https://github.com/standard-things/esm/issues/775
    it("delivers the second deprecation emitted from a once warning listener", async ({
      expect
    }) => {
      await withFiles(
        {
          "index.cjs": `const util = require('node:util')
const fn = () => {}
const deprecated1 = util.deprecate(fn, 'msg1')
const deprecated2 = util.deprecate(fn, 'msg2')
const warnings = []
process.once('warning', warning => {
  warnings.push(warning.message)
  process.once('warning', warning => warnings.push(warning.message))
  deprecated2()
})
deprecated1()
process.on('beforeExit', () => console.log(JSON.stringify(warnings)))
`
        },
        async (directory) => {
          for (const preload of [[], ["-r", loaderPath]]) {
            checkSuccess(
              expect,
              await runNode(
                ["--no-warnings", ...preload, "index.cjs"],
                esmEnv,
                {},
                { cwd: directory }
              ),
              '["msg1","msg2"]'
            )
          }
        }
      )
    })

    // https://github.com/standard-things/esm/issues/824
    it("logs the reported object without an extra empty object under --inspect", async ({
      expect
    }) => {
      await withFiles(
        {
          "a.js": "import './b.js'\nconsole.log({ test: true })\n",
          "b.js": ""
        },
        async (directory) => {
          const result = await runNode(
            ["--inspect=0", "-r", loaderPath, "a.js"],
            esmEnv,
            loaderOptions,
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stdout).toBe("{ test: true }\n")
          expect(result.stderr).toMatch(/^Debugger listening on ws:\/\/127\.0\.0\.1:\d+\//)
          expect(result.stderr.trim().split("\n")).toHaveLength(2)
        }
      )
    })

    // https://github.com/standard-things/esm/issues/924
    it("requires the exported remotion/version subpath with the loader preloaded", async ({
      expect
    }) => {
      await withFiles(
        {
          // Entry points from the published remotion@3.3.31 package.json.
          "node_modules/remotion/package.json": JSON.stringify({
            name: "remotion",
            main: "dist/index.js",
            exports: { ".": "./dist/index.js", "./version": "./dist/version.js" }
          }),
          "node_modules/remotion/dist/index.js": "module.exports = {}\n",
          "node_modules/remotion/dist/version.js": "exports.VERSION = '3.3.31'\n",
          "index.cjs": "console.log(require('remotion/version').VERSION)\n"
        },
        async (directory) => {
          for (const args of [["index.cjs"], ["-r", loaderPath, "index.cjs"]]) {
            checkSuccess(expect, await runNode(args, esmEnv, {}, { cwd: directory }), "3.3.31")
          }
        }
      )
    })

    // https://github.com/standard-things/esm/issues/863
    it("loads root and nested exports through the reported './' folder mapping", async ({
      expect
    }) => {
      await withFiles(
        {
          "node_modules/the-package/package.json": JSON.stringify({
            exports: { ".": "./dist/index.js", "./": "./dist/" }
          }),
          "node_modules/the-package/dist/index.js": "export const blah = 'root'\n",
          "node_modules/the-package/dist/Foo.js": "export const Foo = 'foo'\n",
          "node_modules/the-package/dist/nested/Bar.js": "export const Bar = 'bar'\n",
          "index.js":
            "import { Foo } from 'the-package/Foo.js'; import { blah } from 'the-package'; import { Bar } from 'the-package/nested/Bar.js'; console.log([blah, Foo, Bar].join(':'))\n"
        },
        async (directory) => {
          checkSuccess(
            expect,
            await runNode(["-r", loaderPath, "index.js"], esmEnv, loaderOptions, {
              cwd: directory
            }),
            "root:foo:bar"
          )
        }
      )
    })

    // https://github.com/standard-things/esm/issues/809
    it("sees a CommonJS metadata polyfill after direct and transitive ESM imports", async ({
      expect
    }) => {
      await withFiles(
        {
          // Reproduce reflect-metadata's global patch without a third-party
          // dependency: the issue is visibility of this CommonJS side effect.
          "polyfill.js": `Object.defineProperty(Reflect, 'metadata', {
  configurable: true,
  writable: true,
  value: function metadata() {}
})\n`,
          "dependency.js": "require('./polyfill.js')\n",
          "direct.js": "import './polyfill.js'; console.log(typeof Reflect.metadata)\n",
          "transitive.js": "import './dependency.js'; console.log(typeof Reflect.metadata)\n"
        },
        async (directory) => {
          for (const name of ["direct.js", "transitive.js"]) {
            checkSuccess(
              expect,
              await runNode(["-r", loaderPath, path.join(directory, name)], esmEnv, loaderOptions, {
                cacheNamespace: "upstream-reflect-metadata"
              }),
              "function"
            )
          }
        }
      )
    })

    // https://github.com/standard-things/esm/issues/846
    it("exports the var declared inside the reported if block", async ({ expect }) => {
      await withFiles(
        {
          "value.js": "if (true) {\n    var x = 1;\n}\nexport { x };\n",
          "index.js": "import { x } from './value.js'; console.log(x)\n"
        },
        async (directory) => {
          checkSuccess(
            expect,
            await runNode(
              ["-r", loaderPath, path.join(directory, "index.js")],
              esmEnv,
              loaderOptions,
              {
                cacheNamespace: "upstream-hoisted-var"
              }
            ),
            "1"
          )
        }
      )
    })

    // https://github.com/standard-things/esm/issues/796
    it("loads the reported .esmrc.js mainFields config during cold startup", async ({ expect }) => {
      await withFiles(
        {
          ".esmrc.js": "module.exports = { mainFields: ['module', 'main'] };\n",
          "index.js": "import value from 'config-target'; console.log(value)\n",
          "node_modules/config-target/package.json": JSON.stringify({
            main: "main.js",
            module: "module.js"
          }),
          "node_modules/config-target/main.js": "module.exports = 'wrong-main'\n",
          "node_modules/config-target/module.js": "export default 'configured-module'\n"
        },
        async (directory) => {
          checkSuccess(
            expect,
            await runNode(
              ["-r", loaderPath, "index.js"],
              esmEnv,
              {},
              {
                cwd: directory,
                cacheNamespace: "upstream-esmrc-js"
              }
            ),
            "configured-module"
          )
        }
      )
    })

    // https://github.com/standard-things/esm/issues/843
    it("reports the original zero-width-space source as a syntax error", async ({ expect }) => {
      await withFiles(
        { "test.js": "import path from 'path'\n\u200b\n\nexport default {}\n\n" },
        async (directory) => {
          const result = await runNode(
            ["--max-old-space-size=96", "-r", "../index.js", path.join(directory, "test.js")],
            esmEnv,
            loaderOptions,
            { cacheNamespace: "upstream-zero-width-space", timeout: 5_000 }
          )
          expect(result.exitCode, result.stderr).toBe(1)
          expect(result.stdout).toBe("")
          expect(result.stderr).toMatch(/SyntaxError:/)
          expect(result.stderr).toContain("test.js:2")
          expect(result.stderr).not.toMatch(/heap out of memory|Allocation failed/i)
        }
      )
    })

    // https://github.com/standard-things/esm/issues/926
    it("parses optional chaining when eval occurs in comments or strings", async ({ expect }) => {
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
              expect,
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
    it("executes optional chaining for missing and computed properties", async ({ expect }) => {
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
            expect,
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
    it("loads functions containing optional chaining without calling them", async ({ expect }) => {
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
            expect,
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
    it("executes nullish coalescing in files containing imports", async ({ expect }) => {
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
              expect,
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
    it("reports thrown module errors without printing the bundled loader source", async ({
      expect
    }) => {
      await withFiles(
        { "failure.mjs": "throw new Error('upstream-error-marker')\n" },
        async (directory) => {
          const filename = path.join(directory, "failure.mjs")
          const result = await runNode(["-r", "../index.js", filename], esmEnv, loaderOptions, {
            cacheNamespace: "upstream-error-report"
          })
          expect(result.exitCode).not.toBe(0)
          expect(result.stdout).toBe("")
          expect(result.stderr).toMatch(/Error: upstream-error-marker/)
          expect(
            result.stderr.includes(filename) ||
              result.stderr.includes(pathToFileURL(filename).href),
            result.stderr
          ).toBe(true)
          expect(
            result.stderr.length,
            `Unexpected error output: ${result.stderr.length} bytes`
          ).toBeLessThan(12_000)
          expect(result.stderr).not.toMatch(/const __global__ = this|var __shared__;const/)
        }
      )
    })

    // https://github.com/standard-things/esm/issues/931
    // https://github.com/standard-things/esm/issues/821
    it("loads filesystem built-ins without using removed Node internals", async ({ expect }) => {
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
            expect,
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
    it('loads a "type": "module" package from CommonJS without warnings', async ({ expect }) => {
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
            expect,
            await runNode([path.join(directory, "main.cjs")], esmEnv, loaderOptions, {
              cacheNamespace: "upstream-package-type"
            }),
            "package-type:42"
          )
        }
      )
    })

    // https://github.com/standard-things/esm/issues/816
    it("can initialise the loader more than once without redeclaring globals", async ({
      expect
    }) => {
      await withFiles({ "value.mjs": "export const value = 42\n" }, async (directory) => {
        const source = `const assert = require('node:assert/strict')
const esm = require('../esm.js')
const first = esm(module)
const second = esm(module)
assert.equal(first(process.argv[1]).value, 42)
assert.equal(second(process.argv[1]).value, 42)
console.log('bootstrap-twice:ok')`
        checkSuccess(
          expect,
          await runNode(["-e", source, path.join(directory, "value.mjs")], esmEnv, loaderOptions, {
            cacheNamespace: "upstream-repeat-loader"
          }),
          "bootstrap-twice:ok"
        )
      })
    })

    // https://github.com/standard-things/esm/issues/872
    it("exposes default-export instances through the namespace or cjs.dedefault", async ({
      expect
    }) => {
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
              expect,
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
    it("retains assigned properties when copying mixed CJS/ESM exports", async ({ expect }) => {
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
            expect,
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
    it("invalidates the disk compiler cache when a dependency changes between runs", async ({
      expect
    }) => {
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

          checkSuccess(expect, await execute(), "cache-dependency:before")
          await writeFile(dependency, "export const value = 'after'\n")
          const current = await stat(dependency)
          const nextMtime = new Date(current.mtimeMs + 2_000)
          await utimes(dependency, nextMtime, nextMtime)
          checkSuccess(expect, await execute(), "cache-dependency:after")
        }
      )
    })
  })
}
