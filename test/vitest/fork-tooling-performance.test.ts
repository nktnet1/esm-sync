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
