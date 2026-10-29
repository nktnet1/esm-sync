import { readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { describe, it, type TestContext } from "vitest"
import {
  babelRegister,
  babelPreset,
  tsNodeRegister,
  withCompatibilityFiles
} from "./helpers/coverage.ts"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const require = createRequire(import.meta.url)
const loaderPath = path.resolve(testPath, "../esm.js")
const jestCLI = require.resolve("jest/bin/jest.js")
const protobuf = createRequire(require.resolve("newrelic")).resolve("protobufjs")
const moduleAlias = require.resolve("module-alias")
const babelFlowStrip = require.resolve("@babel/plugin-transform-flow-strip-types")
const startupBenchmark = path.resolve(testPath, "../../script/src/benchmark-startup.ts")
const integrationTimeout = 120_000

// Isolated real-Node subprocesses; no Vite transforms or synthetic Jest mocks.
// Jest 26 is the version installed for this fork. These checks must not be
// mistaken for certification of newer Jest versions.
for (const esmEnv of testEnvironments) {
  describe(`fork tooling investigations (${esmEnv})`, () => {
    // https://github.com/standard-things/esm/issues/794
    it(
      "selects a TypeScript module mainField with ts-node registered, then falls back to main",
      async ({ expect }: TestContext) => {
        await withCompatibilityFiles(
          {
            "node_modules/esm-sync-module-field/package.json": JSON.stringify({
              name: "esm-sync-module-field",
              main: "./dist/index.js",
              module: "./src/index.ts"
            }),
            "node_modules/esm-sync-module-field/src/index.ts": "export const value: number = 42\n",
            "node_modules/esm-sync-module-field/dist/index.js": "module.exports = { value: -1 }\n",
            "node_modules/esm-sync-fallback-field/package.json": JSON.stringify({
              name: "esm-sync-fallback-field",
              main: "./index.js"
            }),
            "node_modules/esm-sync-fallback-field/index.js": "module.exports = { value: 7 }\n",
            "index.cjs": `const load = require(${JSON.stringify(loaderPath)})(module, { cjs: true, mode: 'auto', mainFields: ['module', 'main'] })
console.log(JSON.stringify([load('esm-sync-module-field').value, load('esm-sync-fallback-field').value]))
`,
            "index-babel.cjs": `require(${JSON.stringify(babelRegister)})({
  extensions: ['.ts'], babelrc: false, configFile: false,
  ignore: [], only: [__dirname],
  plugins: [${JSON.stringify(babelFlowStrip)}],
  presets: [${JSON.stringify(babelPreset)}]
})
const load = require(${JSON.stringify(loaderPath)})(module, { cjs: true, mode: 'auto', mainFields: ['module', 'main'] })
console.log(JSON.stringify([load('esm-sync-module-field').value, load('esm-sync-fallback-field').value]))
`
          },
          async (directory) => {
            const result = await runNode(
              ["-r", tsNodeRegister, "index.cjs"],
              esmEnv,
              {
                TS_NODE_TRANSPILE_ONLY: "true",
                TS_NODE_SKIP_PROJECT: "true",
                TS_NODE_SKIP_IGNORE: "true",
                TS_NODE_COMPILER_OPTIONS: JSON.stringify({
                  module: "ESNext",
                  moduleResolution: "Bundler",
                  target: "ES2022"
                })
              },
              { cwd: directory, timeout: 60_000 }
            )
            expect(result.exitCode, result.stderr).toBe(0)
            expect(result.stdout.trim()).toBe("[42,7]")
            const babel = await runNode(
              ["index-babel.cjs"],
              esmEnv,
              {},
              {
                cwd: directory,
                timeout: 60_000
              }
            )
            expect(babel.exitCode, babel.stderr).toBe(0)
            expect(babel.stdout.trim()).toBe("[42,7]")
          }
        )
      },
      integrationTimeout
    )

    // https://github.com/standard-things/esm/issues/810
    it(
      "keeps top-level await working with package imports while CJS aliases remain independent",
      async ({ expect }: TestContext) => {
        await withCompatibilityFiles(
          {
            "node_modules/esm-sync-roadmap-dependency/package.json": JSON.stringify({
              name: "esm-sync-roadmap-dependency",
              exports: "./index.mjs"
            }),
            "node_modules/esm-sync-roadmap-dependency/index.mjs": "export const value = 41\n",
            "entry.mjs":
              "import { value } from 'esm-sync-roadmap-dependency'; export const result = await Promise.resolve(value + 1)\n",
            "legacy.cjs": "module.exports = { value: 40 }\n",
            "index.cjs": `require(${JSON.stringify(moduleAlias)}).addAlias('@roadmap/legacy', require('node:path').join(__dirname, 'legacy.cjs'))
const load = require(${JSON.stringify(loaderPath)})(module, { cjs: false, mode: 'auto' })
console.log(JSON.stringify([require('@roadmap/legacy').value, load('./entry.mjs').result]))
`
          },
          async (directory) => {
            const result = await runNode(
              ["index.cjs"],
              esmEnv,
              {},
              {
                cwd: directory,
                timeout: 60_000
              }
            )
            expect(result.exitCode, result.stderr).toBe(0)
            expect(result.stdout.trim()).toBe("[40,42]")
          }
        )
      },
      integrationTimeout
    )

    // https://github.com/standard-things/esm/issues/779
    // https://github.com/standard-things/esm/issues/875
    // https://github.com/standard-things/esm/issues/706
    it(
      "loads ESM and reads files inside the Jest VM alongside a Jest transform",
      async ({ expect }: TestContext) => {
        await withCompatibilityFiles(
          {
            "jest.config.cjs": `module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['**/*.test.js'],
  transform: { '\\\\.test\\\\.js$': '<rootDir>/jest-transform.cjs' }
}\n`,
            "jest-transform.cjs": `module.exports = {
  process(source) { return source.replace('__JEST_TRANSFORM_TOKEN__', 'transformed') }
}\n`,
            "source.mjs": "export const answer = 42\n",
            "reader.mjs": `import fs from 'node:fs'
export function load(name) { return fs.readFileSync(name, 'utf8') }
`,
            "spec.proto": 'syntax = "proto3";\n',
            "read-esm.test.js": `const load = require(${JSON.stringify(loaderPath)})(module, { cjs: true, mode: 'auto' })
test('ESM imports work in a CJS Jest test', () => expect(load('./source.mjs').answer).toBe(42))
test('ESM reads a file inside the Jest context', () => expect(load('./reader.mjs').load(__dirname + '/spec.proto')).toContain('proto3'))
test('Jest transforms the test source', () => expect('__JEST_TRANSFORM_TOKEN__').toBe('transformed'))
`
          },
          async (directory) => {
            const result = await runNode(
              [jestCLI, "--config", "jest.config.cjs", "--runInBand", "--no-cache", "--silent"],
              esmEnv,
              {},
              { cwd: directory, timeout: 90_000 }
            )
            expect(result.exitCode, result.stderr).toBe(0)
            expect(result.stderr).toMatch(/3 passed/)
          }
        )
      },
      integrationTimeout
    )
  })
}

// https://github.com/standard-things/esm/issues/844
it(
  "reports startup timings for native Node and cold/warm loader runs without timing thresholds",
  async ({ expect }) => {
    const result = await runNode(
      [startupBenchmark, "--iterations=1", "--json"],
      "benchmark",
      {},
      {
        cwd: path.resolve(testPath, ".."),
        timeout: 90_000
      }
    )
    expect(result.exitCode, result.stderr).toBe(0)
    const data = JSON.parse(result.stdout) as {
      iterations: number
      timings: Record<string, { median: number; samples: number[] }>
    }
    expect(data.iterations).toBe(1)
    expect(Object.keys(data.timings).sort()).toStrictEqual(["esmCold", "esmWarm", "native"])
    for (const summary of Object.values(data.timings)) {
      expect(summary.samples).toHaveLength(1)
      expect(summary.median).toBeGreaterThan(0)
    }
  },
  integrationTimeout
)

for (const esmEnv of testEnvironments) {
  describe("completed tooling regressions (" + esmEnv + ")", () => {
    // #779: preserve the historical inquire expression, not just a direct fs import.
    it(
      "keeps eval lexical for protobuf optional modules and loads an actual .proto in Jest",
      async ({ expect }) => {
        await withCompatibilityFiles(
          {
            "jest.config.cjs":
              "module.exports = { rootDir: __dirname, testEnvironment: 'node', testMatch: ['**/*.test.js'], transform: {} }",
            "inquire.cjs":
              "module.exports = function inquire(moduleName) { try { var mod = eval('quire'.replace(/^/, 're'))(moduleName); if (mod && (mod.length || Object.keys(mod).length)) return mod } catch (e) {} return null }; module.exports.evalImport=function(){return eval(\"import('./value.js')\")}",
            "reader.js":
              "import inquire from './inquire.cjs';\n" +
              "import protobuf from " +
              JSON.stringify(protobuf) +
              ";\n" +
              "export const optionalFS = inquire('fs'); export const absent = inquire('esm-sync-nonexistent-optional-dependency');\n" +
              "export function lexical() { const value = 42; return eval('value') }; export async function viaEval(){return (await inquire.evalImport()).value}\n" +
              "export function load(filename) { protobuf.util.fs = optionalFS; return protobuf.loadSync(filename).lookupType('roadmap.Message') }",
            "value.js": "export const value=42",
            "custom.cjs": "exports.value=eval('42')",
            "custom.test.js":
              "test('preserves an application eval override',()=>{const original=global.eval; global.eval=value=>'custom:'+value;try{const load=require(" +
              JSON.stringify(loaderPath) +
              ")(module,{cjs:true,mode:'auto'});expect(load('./custom.cjs').value).toBe('custom:42')}finally{global.eval=original}})",
            "message.proto":
              'syntax = "proto3"; package roadmap; message Message { string text = 1; }',
            "reader.test.js":
              "const load = require(" +
              JSON.stringify(loaderPath) +
              ")(module, { cjs: true, mode: 'auto' });\n" +
              "test('protobuf eval and loadSync', async () => { const reader=load('./reader.js'); expect(typeof reader.optionalFS.readFileSync).toBe('function'); expect(reader.absent).toBe(null); expect(reader.lexical()).toBe(42); expect(await reader.viaEval()).toBe(42); const type=reader.load(__dirname+'/message.proto'); expect(type.decode(type.encode(type.create({text:'working'})).finish()).text).toBe('working') });\n" +
              "test('reset and isolation keep protobuf usable', () => { jest.resetModules(); jest.isolateModules(() => { const fresh=require(" +
              JSON.stringify(loaderPath) +
              ")(module, {cjs:true,mode:'auto'}); expect(fresh('./reader.js').load(__dirname+'/message.proto').name).toBe('Message') }) });"
          },
          async (directory) => {
            const result = await runNode(
              [jestCLI, "--config", "jest.config.cjs", "--runInBand", "--no-cache"],
              esmEnv,
              {},
              { cwd: directory, timeout: 90_000 }
            )
            expect(result.exitCode, result.stderr).toBe(0)
            expect(result.stderr).toMatch(/3 passed/)
          }
        )
      },
      integrationTimeout
    )

    // #875 / #706: Jest transforms the actual ESM test, and retains shared bindings.
    it(
      "runs ESM Jest test sources with globals, lexical jest, shared dependencies and warm transform caches",
      async ({ expect }) => {
        await withCompatibilityFiles(
          {
            "jest.config.cjs":
              'module.exports={rootDir:__dirname,testEnvironment:"node",testMatch:["**/*.test.js"],cacheDirectory:"<rootDir>/jest-cache",globals:{configured:42},transform:{"\\\\.m?js$":' +
              JSON.stringify(loaderPath) +
              "}}",
            "common.js": "export let value=41; export function increment(){value++}",
            "indirect.js": "export {value,increment} from './common.js'",
            "esm.test.js":
              "import {value,increment} from './common.js'; import * as indirect from './indirect.js';\n" +
              "test('direct and transitive imports share bindings',()=>{expect(configured).toBe(42);expect(value).toBe(41);increment();expect(value).toBe(42);expect(indirect.value).toBe(42);expect(jest.fn()()).toBeUndefined()});\n" +
              "test('dynamic import uses the loader',async()=>{expect((await import('./indirect.js')).value).toBe(42)})",
            "cjs.test.js":
              "const {value}=require('./common.js'); test('CommonJS test source',()=>{expect(value).toBe(41);expect(jest.fn(()=>7)()).toBe(7)})"
          },
          async (directory) => {
            for (const args of [["--no-cache"], [], []]) {
              const result = await runNode(
                [jestCLI, "--config", "jest.config.cjs", "--runInBand", ...args],
                esmEnv,
                {},
                { cwd: directory, timeout: 90_000 }
              )
              expect(result.exitCode, result.stderr).toBe(0)
              expect(result.stderr).toMatch(/3 passed/)
            }
            await writeFile(
              path.join(directory, "common.js"),
              "export let value=141; export function increment(){value++}"
            )
            const changed = await runNode(
              [jestCLI, "--config", "jest.config.cjs", "--runInBand"],
              esmEnv,
              {},
              { cwd: directory, timeout: 90_000 }
            )
            expect(changed.exitCode).not.toBe(0)
            expect(changed.stderr).toContain("141")
          }
        )
      },
      integrationTimeout
    )

    // #810: retain ESM and await while Babel rewrites source specifiers.
    it(
      "composes Babel alias rewriting with transitive top-level await and warm caches",
      async ({ expect }) => {
        await withCompatibilityFiles(
          {
            "alias-plugin.cjs":
              "module.exports=()=>({visitor:{ImportDeclaration(p){if(p.node.source.value==='@app/value')p.node.source.value='./value.js'},ExportNamedDeclaration(p){if(p.node.source&&p.node.source.value==='@app/value')p.node.source.value='./value.js'}}})",
            "value.js": "export const value=await Promise.resolve(41)",
            "entry.js":
              "import {value} from '@app/value'; export const result=await Promise.resolve(value+1); export {value} from '@app/value'",
            "index.cjs":
              "require(" +
              JSON.stringify(babelRegister) +
              ')({babelrc:false,configFile:false,only:[__dirname],plugins:[require("./alias-plugin.cjs")],presets:[[' +
              JSON.stringify(babelPreset) +
              ',{targets:{node:"current"},modules:false}]]}); const load=require(' +
              JSON.stringify(loaderPath) +
              ')(module,{cjs:true,mode:"auto",cache:"./esm-cache"}); console.log(JSON.stringify([load("./entry.js").result,load("./entry.js").value]))'
          },
          async (directory) => {
            for (let i = 0; i < 2; i++) {
              const result = await runNode(
                ["index.cjs"],
                esmEnv,
                {},
                { cwd: directory, timeout: 60_000 }
              )
              expect(result.exitCode, result.stderr).toBe(0)
              expect(result.stdout.trim()).toBe("[42,41]")
            }
          }
        )
      },
      integrationTimeout
    )
  })
}

it("implements legacy and modern Jest transform contracts with stable, configuration-sensitive keys", async ({
  expect
}) => {
  const source =
    `const assert=require('node:assert/strict'); const loader=require(` +
    JSON.stringify(loaderPath) +
    `);
const source='export const answer=42', filename=__filename+'.js';
assert.equal(typeof loader.process(source,filename,{}).code,'string');
assert.equal(loader.process(source,filename,{supportsStaticESM:true}).code,source);
assert.equal(loader.process(source,require.resolve(` +
    JSON.stringify(loaderPath) +
    `),{}).code,source);
const key=loader.getCacheKey(source,filename,{configString:'one',instrument:false});
assert.equal(key,loader.getCacheKey(source,filename,{configString:'one',instrument:false}));
for(const other of [loader.getCacheKey(source+' ',filename,{configString:'one',instrument:false}),loader.getCacheKey(source,filename+'.js',{configString:'one',instrument:false}),loader.getCacheKey(source,filename,{configString:'two',instrument:false}),loader.getCacheKey(source,filename,{configString:'one',instrument:true}),loader.getCacheKey(source,filename,'legacy',{instrument:true})])assert.notEqual(key,other);
assert.deepEqual(Object.keys(loader),[]); assert.ok(Object.isFrozen(loader)); console.log('ok');`
  const result = await runNode(["-e", source], testEnvironments[0]!)
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.stdout.trim()).toBe("ok")
})

// #844: use a private package copy, so concurrent suites never mutate this build's bootstrap cache.
it(
  "reads only bootstrap bytecode and immediately replaces rejected or corrupt caches",
  async ({ expect }) => {
    const bootstrap = await readFile(loaderPath, "utf8")
    const loader = await readFile(path.join(path.dirname(loaderPath), "esm/loader.js"), "utf8")
    await withCompatibilityFiles(
      {
        "package/package.json": '{"name":"esm-sync-private-cache","version":"3.4.0"}',
        "package/dist/esm.js": bootstrap,
        "package/dist/esm/loader.js": loader,
        "entry.js": "export const value=42",
        "index.cjs": `const vm=require('node:vm'); const stats={bytes:0,rejected:false,generated:0};
vm.Script=new Proxy(vm.Script,{construct(Target,args,newTarget){const script=Reflect.construct(Target,args,newTarget);if(args[0].startsWith('const __global__ = this;')){stats.bytes=args[1].cachedData===undefined?0:args[1].cachedData.length;stats.rejected=script.cachedDataRejected===true;const create=script.createCachedData;script.createCachedData=function(){stats.generated++;return create.call(this)}}return script}});
const load=require('./package/dist/esm.js')(module,{cjs:true,mode:'auto',cache:'./modules-cache'});require('node:assert/strict').equal(load('./entry.js').value,42);process.on('exit',()=>console.log(JSON.stringify(stats)));`
      },
      async (directory) => {
        const invoke = async (env: NodeJS.ProcessEnv = {}) => {
          const result = await runNode(["index.cjs"], testEnvironments[0]!, env, { cwd: directory })
          expect(result.exitCode, result.stderr).toBe(0)
          return JSON.parse(result.stdout) as {
            bytes: number
            rejected: boolean
            generated: number
          }
        }
        expect((await invoke()).generated).toBe(1)
        const cache = path.join(directory, "package/node_modules/.cache/esm")
        const blobPath = path.join(cache, ".data.blob"),
          metaPath = path.join(cache, ".data.json")
        const blob = await readFile(blobPath)
        const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
          version: string
          meta: { esm: number[] }
        }
        const [start, end] = meta.meta.esm as [number, number]
        const prefix = Buffer.from("unrelated-bytecode")
        await writeFile(blobPath, Buffer.concat([prefix, blob, Buffer.from("unrelated-tail")]))
        meta.meta.esm = [start + prefix.length, end + prefix.length]
        await writeFile(metaPath, JSON.stringify(meta))
        expect(await invoke()).toStrictEqual({ bytes: end - start, rejected: false, generated: 0 })
        await writeFile(metaPath, JSON.stringify({ ...meta, version: "0.0.0" }))
        expect((await invoke()).bytes).toBe(0)
        await writeFile(blobPath, Buffer.alloc((await readFile(blobPath)).length))
        const rejected = await invoke()
        expect(rejected.rejected).toBe(true)
        expect(rejected.generated).toBe(1)
        expect((await invoke()).rejected).toBe(false)
        for (const metadata of [
          "{broken",
          JSON.stringify({ meta: { esm: [-1, -1] } }),
          JSON.stringify({ meta: { esm: [0, Number.MAX_SAFE_INTEGER] } }),
          JSON.stringify({ meta: {} })
        ]) {
          await writeFile(metaPath, metadata)
          const recovered = await invoke()
          expect(recovered.bytes).toBe(0)
          expect(recovered.generated).toBe(1)
        }
        expect(await invoke({ ESM_DISABLE_CACHE: "true" })).toStrictEqual({
          bytes: 0,
          rejected: false,
          generated: 0
        })
      }
    )
  },
  integrationTimeout
)
