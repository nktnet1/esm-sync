import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const libraryPath = path.resolve(testPath, "../esm.js")
const warningFlag = "--disable-warning=ExperimentalWarning"

async function withFiles(
  files: Record<string, string>,
  test: (directory: string) => Promise<void>
) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-ts-")))
  try {
    for (const [name, source] of Object.entries(files)) {
      const filename = path.join(directory, name)
      await mkdir(path.dirname(filename), { recursive: true })
      await writeFile(filename, source)
    }
    await test(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

for (const esmEnv of testEnvironments) {
  describe(`native TypeScript in the loader (${esmEnv})`, () => {
    it("strips erasable .ts/.mts/.cts syntax across ESM and CommonJS dependencies", async () => {
      await withFiles(
        {
          "typed.ts": `export type Value = number
export interface Result { value: number }
export const value: Value = 40
`,
          "typed.cts": `interface Config { increment: number }
const settings: Config = { increment: 2 }
module.exports = settings
`,
          "typed.mts": `import type { Result } from './typed.ts'
import { value } from './typed.ts'
import config from './typed.cts'
export const result: Result = { value: value + config.increment }
export const requireType = typeof require
`,
          "consumer.cjs": `const load = require(${JSON.stringify(libraryPath)})(module)
const esm = load('./typed.mts')
const cjs = load('./typed.cts')
const ts = load('./typed.ts')
console.log(JSON.stringify([esm.result.value, cjs.increment, ts.value, esm.requireType]))
`
        },
        async (directory) => {
          for (const cache of [false, path.join(directory, "cache")]) {
            for (let attempt = 0; attempt < (cache ? 2 : 1); attempt++) {
              const result = await runNode(
                [warningFlag, "consumer.cjs"],
                esmEnv,
                {
                  ESM_OPTIONS: JSON.stringify({ cjs: true, cache })
                },
                { cwd: directory }
              )
              expect(result.exitCode, result.stderr).toBe(0)
              expect(result.stderr).toBe("")
              expect(JSON.parse(result.stdout)).toEqual([42, 2, 40, "undefined"])
            }
          }
        }
      )
    })

    it("does not resolve erased type-only imports or evaluate a cached .mts twice", async () => {
      await withFiles(
        {
          "value.mts": `import type { Missing } from './not-installed.ts'
interface Value { count: number }
globalThis.runs = (globalThis.runs || 0) + 1
export const value: Value = { count: globalThis.runs }
`,
          "consumer.cjs": `const load = require(${JSON.stringify(libraryPath)})(module)
const first = load('./value.mts')
const second = load('./value.mts')
console.log(JSON.stringify([first.value.count, second.value.count, globalThis.runs, first === second]))
`
        },
        async (directory) => {
          const result = await runNode(
            [warningFlag, "consumer.cjs"],
            esmEnv,
            {},
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stderr).toBe("")
          expect(JSON.parse(result.stdout)).toEqual([1, 1, 1, true])
        }
      )
    })

    it("imports an erasable .ts module from a strict .mjs parent", async () => {
      await withFiles(
        {
          "typed.ts": "export const answer: number = 42\n",
          "entry.mjs": "import {answer} from './typed.ts'; export default answer\n",
          "consumer.cjs": `const load = require(${JSON.stringify(libraryPath)})(module)
console.log(JSON.stringify(load('./entry.mjs').default))
`
        },
        async (directory) => {
          const result = await runNode(
            [warningFlag, "consumer.cjs"],
            esmEnv,
            {},
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stderr).toBe("")
          expect(JSON.parse(result.stdout)).toBe(42)
        }
      )
    })

    it("handles .ts CommonJS files with type annotations", async () => {
      await withFiles(
        {
          "common.ts": `type NumberPair = [number, number]
const values: NumberPair = [19, 23]
module.exports = { total: values[0] + values[1] }
`,
          "consumer.cjs": `const load = require(${JSON.stringify(libraryPath)})(module)
console.log(JSON.stringify(load('./common.ts')))
`
        },
        async (directory) => {
          const result = await runNode(
            [warningFlag, "consumer.cjs"],
            esmEnv,
            {},
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stderr).toBe("")
          expect(JSON.parse(result.stdout)).toEqual({ total: 42 })
        }
      )
    })

    it("keeps strict .mts scope isolated from CommonJS compatibility globals", async () => {
      await withFiles(
        {
          "entry.mts": `export const direct = typeof require
export const indirect = eval('typeof require')
`,
          "consumer.cjs": `const load = require(${JSON.stringify(libraryPath)})(module)
const entry = load('./entry.mts')
console.log(JSON.stringify([entry.direct, entry.indirect]))
`
        },
        async (directory) => {
          const result = await runNode(
            [warningFlag, "consumer.cjs"],
            esmEnv,
            { ESM_OPTIONS: "{cjs:true,mode:'auto'}" },
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stderr).toBe("")
          expect(JSON.parse(result.stdout)).toEqual(["undefined", "undefined"])
        }
      )
    })

    it("loads encoded .mts file URLs with query strings and fragments", async () => {
      await withFiles(
        {
          "with space.mts": "export const value: number = 42\n",
          "consumer.cjs": `const load = require(${JSON.stringify(libraryPath)})(module)
const { pathToFileURL } = require('node:url')
const url = pathToFileURL(require('node:path').resolve('with space.mts')).href
console.log(JSON.stringify([url, url + '?cache=1', url + '#fragment'].map(id => load(id).value)))
`
        },
        async (directory) => {
          const result = await runNode(
            [warningFlag, "consumer.cjs"],
            esmEnv,
            {},
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stderr).toBe("")
          expect(JSON.parse(result.stdout)).toEqual([42, 42, 42])
        }
      )
    })

    it("resolves TypeScript files through package imports and conditional exports", async () => {
      await withFiles(
        {
          "package.json": JSON.stringify({
            name: "typed-self",
            type: "module",
            imports: { "#value": "./value.ts" },
            exports: { "./feature": { import: "./feature.mts", require: "./feature.cts" } }
          }),
          "value.ts": "export const value: number = 42\n",
          "feature.mts": `import { value } from '#value'
export const answer: number = value
`,
          "feature.cts": "module.exports = {answer: 43}\n",
          "entry.mts": `import { answer } from 'typed-self/feature'
export const result: number = answer
`,
          "consumer.cjs": `const load = require(${JSON.stringify(libraryPath)})(module)
console.log(JSON.stringify([load('./entry.mts').result, load('typed-self/feature').answer]))
`
        },
        async (directory) => {
          const result = await runNode(
            [warningFlag, "consumer.cjs"],
            esmEnv,
            {},
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stderr).toBe("")
          expect(JSON.parse(result.stdout)).toEqual([42, 43])
        }
      )
    })

    it("retains JavaScript-syntax TypeScript compatibility without native stripping", async () => {
      await withFiles(
        {
          "plain.ts": "export const answer = 42\n",
          "consumer.cjs": `require('node:module').stripTypeScriptTypes = undefined
const load = require(${JSON.stringify(libraryPath)})(module)
console.log(JSON.stringify(load('./plain.ts')))
`
        },
        async (directory) => {
          const result = await runNode(
            [warningFlag, "consumer.cjs"],
            esmEnv,
            {},
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stderr).toBe("")
          expect(JSON.parse(result.stdout)).toEqual({ answer: 42 })
        }
      )
    })

    it("reports non-erasable TypeScript rather than retrying its module body", async () => {
      await withFiles(
        {
          "unsupported.mts": "export enum Role { Admin = 1 }\n",
          "consumer.cjs": `const load = require(${JSON.stringify(libraryPath)})(module)
try { load('./unsupported.mts') } catch (error) {
  console.log(JSON.stringify([error.name, error.code, error.stack.includes('unsupported.mts')]))
}
`
        },
        async (directory) => {
          const result = await runNode(
            [warningFlag, "consumer.cjs"],
            esmEnv,
            {},
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stderr).toBe("")
          expect(JSON.parse(result.stdout)).toEqual([
            "SyntaxError",
            "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
            true
          ])
        }
      )
    })
  })
}
