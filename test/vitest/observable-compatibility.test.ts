import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it, type TestContext } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loaderPath = path.resolve(testPath, "../esm.js")

async function withFiles(
  files: Record<string, string>,
  run: (directory: string) => Promise<void>
): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-observable-")))
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

function success(expect: TestContext["expect"], result: Awaited<ReturnType<typeof runNode>>) {
  expect(result.exitCode, result.stderr || result.stdout).toBe(0)
  expect(result.stderr).toBe("")
  return result.stdout
}

for (const esmEnv of testEnvironments) {
  describe.concurrent(`CommonJS accessors (${esmEnv})`, () => {
    for (const mutableNamespace of [false, true]) {
      for (const extension of ["js", "mjs"]) {
        it(`keeps default accessors lazy in .${extension} imports (mutableNamespace=${mutableNamespace})`, async ({
          expect
        }) => {
          await withFiles(
            {
              "value.cjs": `let reads = 0
function value() { return 'function' }
value.reads = () => reads
Object.defineProperty(value, 'default', {
  enumerable: true, configurable: true,
  get() { reads++; if (this !== value) throw new Error('wrong receiver'); return 'legacy' }
})
module.exports = value
`,
              [`index.${extension}`]: `import value, * as ns from './value.cjs'
const descriptor = Object.getOwnPropertyDescriptor(ns, 'default')
const output = [value(), value.reads(), ns.default === value, descriptor.value === value, value.reads()]
output.push(value.default, value.reads(), ns.default.default, value.reads())
console.log(JSON.stringify(output))
`
            },
            async (directory) => {
              const filename = `index.${extension}`
              const native = await runNode([filename], esmEnv, {}, { cwd: directory })
              const expected = success(expect, native)
              expect(JSON.parse(expected)).toStrictEqual([
                "function",
                0,
                true,
                true,
                0,
                "legacy",
                1,
                "legacy",
                2
              ])
              for (const esModule of [false, true]) {
                const result = await runNode(
                  ["-r", loaderPath, filename],
                  esmEnv,
                  {
                    ESM_OPTIONS: `{cjs:{esModule:${esModule},mutableNamespace:${mutableNamespace}},mode:'auto'}`
                  },
                  { cwd: directory }
                )
                expect(success(expect, result)).toBe(expected)
              }
            }
          )
        })
      }
    }

    it("does not touch throwing or non-enumerable default getters during imports and re-exports", async ({
      expect
    }) => {
      await withFiles(
        {
          "value.cjs": `module.exports = { label: 'value' }
Object.defineProperty(module.exports, 'default', { get() { throw new Error('explicit access') } })
`,
          "bridge.js": "export { default } from './value.cjs'\n",
          "index.js": `import './value.cjs'
import value, * as ns from './bridge.js'
const output = [value.label, ns.default === value]
try { value.default } catch (error) { output.push(error.message) }
console.log(JSON.stringify(output))
`
        },
        async (directory) => {
          const expected = success(
            expect,
            await runNode(["index.js"], esmEnv, {}, { cwd: directory })
          )
          expect(JSON.parse(expected)).toStrictEqual(["value", true, "explicit access"])
          expect(
            success(
              expect,
              await runNode(
                ["-r", loaderPath, "index.js"],
                esmEnv,
                { ESM_OPTIONS: "{cjs:true,mode:'auto'}" },
                { cwd: directory }
              )
            )
          ).toBe(expected)
        }
      )
    })

    it("reads an explicit __esModule default getter", async ({ expect }) => {
      await withFiles(
        {
          "value.cjs": `let reads = 0
module.exports = {
  __esModule: true,
  get default() { reads++; return 'transpiled' },
  reads() { return reads }
}
`,
          "index.js": `import value, * as ns from './value.cjs'
console.log(JSON.stringify([value, ns.default, ns.reads() > 0]))
`
        },
        async (directory) => {
          const result = await runNode(
            ["-r", loaderPath, "index.js"],
            esmEnv,
            { ESM_OPTIONS: "{cjs:true,mode:'auto'}" },
            { cwd: directory }
          )
          expect(JSON.parse(success(expect, result))).toStrictEqual([
            "transpiled",
            "transpiled",
            true
          ])
        }
      )
    })

    it("keeps the synthetic default when its object's default property changes", async ({
      expect
    }) => {
      await withFiles(
        {
          "value.cjs": "module.exports = { default: 'initial', label: 'value' }\n",
          "index.js": `import value, * as ns from './value.cjs'
const captured = value
const output = []
function record() { output.push(value === captured, ns.default === captured, value.label) }
record()
value.default = 'changed'
record()
Object.defineProperty(value, 'default', { configurable: true, get() { return 'getter' } })
record()
output.push(value.default)
record()
delete value.default
record()
const descriptor = Object.getOwnPropertyDescriptor(ns, 'default')
output.push(descriptor.value === captured)
console.log(JSON.stringify(output))
`
        },
        async (directory) => {
          const expected = success(
            expect,
            await runNode(["index.js"], esmEnv, {}, { cwd: directory })
          )
          for (const mutableNamespace of [false, true]) {
            const result = await runNode(
              ["-r", loaderPath, "index.js"],
              esmEnv,
              { ESM_OPTIONS: `{cjs:{mutableNamespace:${mutableNamespace}},mode:'auto'}` },
              { cwd: directory }
            )
            expect(success(expect, result)).toBe(expected)
          }
        }
      )
    })
  })

  describe.concurrent(`process warnings (${esmEnv})`, () => {
    for (const kind of ["deprecate", "emitWarning"]) {
      it(`delivers chained ${kind} warnings in native order without suppressing listener callbacks`, async ({
        expect
      }) => {
        await withFiles(
          {
            "index.cjs": `const warnings = []
const emit = ${
              kind === "deprecate"
                ? "[1, 2, 3].map(i => require('node:util').deprecate(() => warnings.push('call:' + i), 'msg' + i, 'CHAIN' + i))"
                : "[1, 2, 3].map(i => () => process.emitWarning('msg' + i, { type: 'DeprecationWarning', code: 'CHAIN' + i, detail: 'detail' + i }))"
            }
let next = 0
function listen(warning) {
  warnings.push([warning.name, warning.message, warning.code, process.noDeprecation === true])
  if (++next < emit.length) {
    process.once('warning', listen)
    emit[next]()
  }
}
process.once('warning', listen)
emit[0]()
process.nextTick(() => warnings.push('tick'))
Promise.resolve().then(() => warnings.push('promise'))
process.on('beforeExit', () => console.log(JSON.stringify(warnings)))
`
          },
          async (directory) => {
            const expected = success(
              expect,
              await runNode(["--no-warnings", "index.cjs"], esmEnv, {}, { cwd: directory })
            )
            const report = JSON.parse(expected) as unknown[]
            expect(report.filter(Array.isArray)).toStrictEqual(
              [1, 2, 3].map((i) => ["DeprecationWarning", `msg${i}`, `CHAIN${i}`, false])
            )
            const result = await runNode(
              ["--no-warnings", "-r", loaderPath, "index.cjs"],
              esmEnv,
              {},
              { cwd: directory }
            )
            expect(success(expect, result)).toBe(expected)
          }
        )
      })
    }

    it("preserves noDeprecation changes made inside a nextTick callback", async ({ expect }) => {
      await withFiles(
        {
          "index.cjs": `process.nextTick(() => { process.noDeprecation = true })
setImmediate(() => console.log(JSON.stringify(process.noDeprecation)))
`
        },
        async (directory) => {
          for (const preload of [[], ["-r", loaderPath]]) {
            expect(
              success(
                expect,
                await runNode([...preload, "index.cjs"], esmEnv, {}, { cwd: directory })
              )
            ).toBe("true\n")
          }
        }
      )
    })

    it("respects explicit warning suppression and deprecation errors", async ({ expect }) => {
      await withFiles(
        {
          "index.cjs": `const warnings = []
process.on('warning', warning => warnings.push(warning.message))
process.on('uncaughtException', error => warnings.push('thrown:' + error.message))
require('node:util').deprecate(() => {}, 'deprecated')()
process.on('beforeExit', () => console.log(JSON.stringify(warnings)))
`
        },
        async (directory) => {
          for (const [flag, report] of [
            ["--no-deprecation", []],
            ["--throw-deprecation", ["thrown:deprecated"]]
          ] as const) {
            const expected = success(
              expect,
              await runNode([flag, "index.cjs"], esmEnv, {}, { cwd: directory })
            )
            expect(JSON.parse(expected)).toStrictEqual(report)
            expect(
              success(
                expect,
                await runNode([flag, "-r", loaderPath, "index.cjs"], esmEnv, {}, { cwd: directory })
              )
            ).toBe(expected)
          }
        }
      )
    })
  })

  describe.concurrent(`inspector console (${esmEnv})`, () => {
    it("formats objects, primitives, and placeholders once with an active inspector", async ({
      expect
    }) => {
      await withFiles(
        {
          "empty.cjs": "",
          "index.mjs": `import './empty.cjs'
import { Console } from 'node:console'
import { PassThrough } from 'node:stream'
console.log({ test: true })
console.log('primitive', 42, null, undefined)
console.log('%s %d %o', 'text', 42, { test: true })
console.info([1, { value: 2 }])
console.dir({ nested: { test: true } })
console.warn({ warning: true })
console.error('error: %o', { test: true })
console.assert(false, 'assert: %o', { test: true })
const stream = new PassThrough()
stream.on('data', chunk => process.stdout.write(chunk))
new Console(stream).log({ custom: true })
`
        },
        async (directory) => {
          const native = await runNode(["--inspect=0", "index.mjs"], esmEnv, {}, { cwd: directory })
          expect(native.exitCode, native.stderr).toBe(0)
          for (const inspector of [
            { args: ["--inspect=0"], env: {} },
            { args: [], env: { NODE_OPTIONS: "--disable-warning=DEP0144 --inspect=0" } }
          ]) {
            const result = await runNode(
              [...inspector.args, "-r", loaderPath, "index.mjs"],
              esmEnv,
              { ...inspector.env, ESM_OPTIONS: "{cjs:true,mode:'auto'}" },
              { cwd: directory }
            )
            expect(result.exitCode, result.stderr).toBe(0)
            expect(result.stdout).toBe(native.stdout)
            const stripStartup = (stderr: string) =>
              stderr.replace(/^Debugger listening on [^\n]+\nFor help, see: [^\n]+\n/, "")
            expect(stripStartup(result.stderr)).toBe(stripStartup(native.stderr))
          }
        }
      )
    })

    it("keeps original objects in inspector events and emits each call once", async ({
      expect
    }) => {
      await withFiles(
        {
          "index.mjs": `import inspector from 'node:inspector'
const session = new inspector.Session()
session.connect()
const events = []
session.on('Runtime.consoleAPICalled', ({ params }) => {
  events.push([params.type, params.args.map(arg => [arg.type, arg.value ?? arg.description])])
})
session.post('Runtime.enable')
console.log({ test: true }, 'message')
console.warn('warning', 42)
session.post('Runtime.disable')
session.disconnect()
process.stdout.write('events:' + JSON.stringify(events) + '\\n')
`
        },
        async (directory) => {
          const native = await runNode(["--inspect=0", "index.mjs"], esmEnv, {}, { cwd: directory })
          expect(native.exitCode, native.stderr).toBe(0)
          expect(native.stdout).toContain(
            'events:[["log",[["object","Object"],["string","message"]]],["warning",[["string","warning"],["number",42]]]]'
          )
          const result = await runNode(
            ["--inspect=0", "-r", loaderPath, "index.mjs"],
            esmEnv,
            { ESM_OPTIONS: "{cjs:true,mode:'auto'}" },
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stdout).toBe(native.stdout)
          expect(result.stderr.replace(/ws:\/\/[^\n]+/, "<inspector>")).toBe(
            native.stderr.replace(/ws:\/\/[^\n]+/, "<inspector>")
          )
        }
      )
    })
  })
}
