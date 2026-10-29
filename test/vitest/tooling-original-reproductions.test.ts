import path from "node:path"
import { readdir, realpath, rm } from "node:fs/promises"
import { describe, it } from "vitest"
import { babelPreset, babelRegister, withCompatibilityFiles } from "./helpers/coverage.ts"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loader = path.resolve(testPath, "../esm.js")
const benchmark = path.resolve(testPath, "../../script/src/benchmark-startup.ts")

for (const esmEnv of testEnvironments) {
  describe(`original tooling report mechanisms (${esmEnv})`, () => {
    it("finishes #810's await-only dependency after Babel module conversion in both hook orders", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "database.js":
            "const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)); await sleep(10); globalThis.databaseReady = true; globalThis.databaseLoads = (globalThis.databaseLoads || 0) + 1",
          "entry.js": `import './database.js'
if (!globalThis.databaseReady || globalThis.databaseLoads !== 1) throw new Error('database evaluation order/count')
export const ready = globalThis.databaseReady`,
          "babel.cjs": `require(${JSON.stringify(babelRegister)})({
  babelrc:false, configFile:false, only:[__dirname],
  presets:[[${JSON.stringify(babelPreset)},{targets:{node:'current'},
    ...(process.env.PRESERVE_ESM === 'true' ? {modules:false} : {})}]]
})`,
          "index.cjs": `const assert=require('node:assert/strict')
const load=require(${JSON.stringify(loader)})(module)
assert.equal(load('./entry.js').ready, true)
assert.equal(globalThis.databaseReady, true)
assert.equal(globalThis.databaseLoads, 1)
console.log('ready')`
        },
        async (directory) => {
          for (const [transition, preserve] of ["false", "true", "false"].entries()) {
            for (const preloads of [
              [loader, "./babel.cjs"],
              ["./babel.cjs", loader]
            ]) {
              for (const entry of ["entry.js", "index.cjs"]) {
                for (let index = 0; index < 2; index++) {
                  const result = await runNode(
                    [...preloads.flatMap((filename) => ["-r", filename]), entry],
                    esmEnv,
                    {
                      PRESERVE_ESM: preserve,
                      ESM_OPTIONS: "{await:true,cjs:true,mode:'auto',cache:'./esm-cache'}"
                    },
                    { cwd: directory, timeout: 60_000 }
                  )
                  expect(
                    result.exitCode,
                    `transition=${transition}, preserve=${preserve}, preloads=${JSON.stringify(preloads)}, entry=${entry}, run=${index}\n${result.stderr}`
                  ).toBe(0)
                  expect(result.stdout.trim()).toBe(entry === "entry.js" ? "" : "ready")
                }
              }
            }
          }
        }
      )
    }, 120_000)

    it("default-imports tslib-style CommonJS bundles that mark __esModule without exporting default", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "tslib.cjs": `const value = { __awaiter: () => 42 }
Object.defineProperty(value, '__esModule', { value: true })
module.exports = value`,
          "transpiled.cjs": `module.exports = { __esModule: true, default: 'explicit' }`,
          "empty.cjs": `Object.defineProperty(exports, '__esModule', { value: true })`,
          "marker-only.cjs": `module.exports = { __esModule: true }`,
          "entry.js": `import tslib, * as tslibNamespace from './tslib.cjs'
import explicit from './transpiled.cjs'
import * as emptyNamespace from './empty.cjs'
import * as markerOnlyNamespace from './marker-only.cjs'
if (tslib.__awaiter() !== 42 || tslibNamespace.default !== tslib || explicit !== 'explicit') {
  throw new Error('CommonJS default interop failed')
}
if (Object.keys(emptyNamespace).length !== 0 || Object.hasOwn(markerOnlyNamespace, 'default')) {
  throw new Error('Pseudo-ESM marker-only modules must not gain synthetic defaults')
}
console.log('interop:ok')`,
          "index.cjs": `const load=require(${JSON.stringify(loader)})(module, {
  mode:'auto', cjs:{esModule:true,namedExports:true}, cache:'./esm-cache'
})
load('./entry.js')`
        },
        async (directory) => {
          for (const entry of ["entry.js", "index.cjs"]) {
            for (let index = 0; index < 2; index++) {
              const result = await runNode(
                entry === "entry.js" ? ["-r", loader, entry] : [entry],
                esmEnv,
                {
                  ESM_OPTIONS:
                    "{mode:'auto',cjs:{esModule:true,namedExports:true},cache:'./esm-cache'}"
                },
                { cwd: directory }
              )
              expect(result.exitCode, result.stderr).toBe(0)
              expect(result.stdout.trim()).toBe("interop:ok")
              expect(result.stderr.trim()).toBe("")
            }
          }
        }
      )
    })

    it("recompiles missing transformed cache files while retaining their metadata and bytecode", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "value.js": "export default await Promise.resolve(42)",
          "index.cjs": `const load=require(${JSON.stringify(loader)})(module)
console.log(load('./value.js').default)`
        },
        async (directory) => {
          const cache = path.join(directory, "esm-cache")
          for (const run of ["cold", "warm", "repaired", "warm-again"]) {
            if (run === "repaired") {
              const files = (await readdir(cache)).filter((name) => name.endsWith(".js"))
              expect(files.length).toBeGreaterThan(0)
              for (const name of files) await rm(path.join(cache, name))
            }
            const result = await runNode(
              ["index.cjs"],
              esmEnv,
              { ESM_OPTIONS: "{cjs:true,mode:'auto',cache:'./esm-cache'}" },
              { cwd: directory }
            )
            expect(result.exitCode, `${run}\n${result.stderr}`).toBe(0)
            expect(result.stdout.trim()).toBe("42")
          }
        }
      )
    })

    it("preserves native CommonJS await identifiers when legacy await support is enabled", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "leaf.cjs": "var await=42; module.exports=await",
          "entry.js":
            "const value=require('./leaf.cjs'); module.exports={value,async read(){return await Promise.resolve(value)}}",
          "native.cjs":
            "const value=require('./entry.js'); value.read().then(result=>console.log(JSON.stringify([value.value,result])))",
          "loader.cjs": `const load=require(${JSON.stringify(loader)})(module,{
  cjs:true,mode:'auto',await:process.env.LEGACY_AWAIT==='true',cache:'./esm-cache'
})
const value=load('./entry.js'); value.read().then(result=>console.log(JSON.stringify([value.value,result])))`
        },
        async (directory) => {
          const native = await runNode(["native.cjs"], esmEnv, {}, { cwd: directory })
          expect(native.exitCode, native.stderr).toBe(0)
          expect(native.stdout.trim()).toBe("[42,42]")
          for (const enabled of ["false", "true"]) {
            const result = await runNode(
              ["loader.cjs"],
              esmEnv,
              { LEGACY_AWAIT: enabled },
              { cwd: directory }
            )
            expect(result.exitCode, result.stderr).toBe(0)
            expect(result.stdout).toBe(native.stdout)
          }
        }
      )
    })

    it("retains CommonJS exports in cold and warm legacy-await scripts with cjs.vars disabled", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "value.js": "await Promise.resolve(); exports.number = 42",
          "index.cjs": `const assert = require('node:assert/strict')
const load = require(${JSON.stringify(loader)})(module, {await:true,cjs:false,mode:'auto',cache:'./esm-cache'})
const value = load('./value.js')
setImmediate(() => { assert.equal(value.number, 42); console.log('ready') })`
        },
        async (directory) => {
          for (let index = 0; index < 2; index++) {
            const result = await runNode(["index.cjs"], esmEnv, {}, { cwd: directory })
            expect(result.exitCode, result.stderr).toBe(0)
            expect(result.stdout.trim()).toBe("ready")
          }
        }
      )
    })
  })
}

it("benchmarks an actual CommonJS CLI entry with its cwd and arguments", async ({ expect }) => {
  await withCompatibilityFiles(
    {
      "value.cjs": "module.exports=42",
      "entry.cjs":
        "const value=require('./value.cjs'); require('node:assert/strict').ok(process.execArgv.includes('--no-deprecation')); console.log(JSON.stringify([value,process.cwd(),process.argv.slice(2)]))"
    },
    async (directory) => {
      const entry = path.join(directory, "entry.cjs")
      const result = await runNode(
        [
          benchmark,
          "--iterations=1",
          "--json",
          "--await",
          "--node-arg=--no-deprecation",
          `--entry=${entry}`,
          `--cwd=${directory}`,
          `--loader=${loader}`,
          "--",
          "--version"
        ],
        testEnvironments[0]!,
        {},
        { cwd: path.resolve(testPath, ".."), timeout: 90_000 }
      )
      expect(result.exitCode, result.stderr).toBe(0)
      const report = JSON.parse(result.stdout) as {
        application: { entry: string; cwd: string; args: string[] }
        moduleCount: null
        legacyAwait: boolean
        nodeArgs: string[]
        timings: Record<string, { samples: number[] }>
      }
      expect(report.application).toStrictEqual({
        entry: await realpath(entry),
        cwd: await realpath(directory),
        args: ["--version"]
      })
      expect(report.moduleCount).toBeNull()
      expect(report.legacyAwait).toBe(true)
      expect(report.nodeArgs).toStrictEqual(["--no-deprecation"])
      expect(Object.keys(report.timings).sort()).toStrictEqual(["esmCold", "esmWarm", "native"])
      for (const timing of Object.values(report.timings)) expect(timing.samples).toHaveLength(1)
    }
  )
}, 120_000)

it("rejects application timings when native and loader output differ", async ({ expect }) => {
  await withCompatibilityFiles(
    {
      "entry.cjs": "console.log(process.execArgv.includes('-r')?'loader':'native')"
    },
    async (directory) => {
      const result = await runNode(
        [benchmark, "--iterations=1", `--entry=${path.join(directory, "entry.cjs")}`],
        testEnvironments[0]!,
        {},
        { cwd: path.resolve(testPath, ".."), timeout: 90_000 }
      )
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("output differs from native Node")
    }
  )
}, 120_000)
