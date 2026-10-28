import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it, type TestContext } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loaderPath = path.resolve(testPath, "../esm.js")
const formats = [
  [".esmrc", "{ mainFields: ['module', 'main'] }"],
  [".esmrc.json", '{ "mainFields": ["module", "main"] }'],
  [".esmrc.js", "module.exports = require('./config.cjs')"],
  [".esmrc.cjs", "module.exports = require('./config.cjs')"],
  [".esmrc.mjs", "export { mainFields } from './config.mjs'"]
] as const

async function withFiles(
  files: Record<string, string>,
  run: (directory: string) => Promise<void>
): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-config-")))
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
  expect(result.exitCode, result.stderr.slice(-4_000)).toBe(0)
  expect(result.stdout.trim()).toBe(output)
  expect(result.stderr).toBe("")
}

const targetFiles = {
  "entry.js": "import value from 'config-target'; console.log(value)\n",
  "node_modules/config-target/package.json": JSON.stringify({
    main: "main.js",
    module: "module.js"
  }),
  "node_modules/config-target/main.js": "module.exports = 'main'\n",
  "node_modules/config-target/module.js": "export default 'module'\n",
  "config.cjs": "module.exports = { mainFields: ['module', 'main'] }\n",
  "config.mjs": "export const mainFields = ['module', 'main']\n",
  "factory.cjs": `require(${JSON.stringify(loaderPath)})(module)('./entry.js')\n`
}

for (const esmEnv of testEnvironments) {
  describe.concurrent(`package configuration startup (${esmEnv})`, () => {
    for (const [filename, source] of formats) {
      for (const entry of ["preload", "factory"] as const) {
        it(`loads ${filename} and its dependencies through ${entry}`, async ({ expect }) => {
          await withFiles({ ...targetFiles, [filename]: source }, async (directory) => {
            const args = entry === "preload" ? ["-r", loaderPath, "entry.js"] : ["factory.cjs"]
            // Reuse the same files in a second process to exercise persisted
            // compiler data as well as a completely cold configuration load.
            for (let attempt = 0; attempt < 2; attempt++) {
              checkSuccess(expect, await runNode(args, esmEnv, {}, { cwd: directory }), "module")
            }
          })
        })
      }
    }

    it("loads config dependencies outside the package before a default exists", async ({
      expect
    }) => {
      await withFiles(
        {
          "options.cjs": "module.exports = { mode: 'all', cjs: false }\n",
          "app/.esmrc.js": "module.exports = require('../options.cjs')\n",
          "app/entry.js": "console.log(typeof require)\n"
        },
        async (directory) => {
          // cjs:false disables CommonJS globals; the dependency's options must
          // still be applied after its temporary bootstrap package is removed.
          checkSuccess(
            expect,
            await runNode(
              ["-r", loaderPath, "entry.js"],
              esmEnv,
              {},
              {
                cwd: path.join(directory, "app")
              }
            ),
            "undefined"
          )
        }
      )
    })

    for (const [source, message, expected] of [
      [
        "throw new Error('config-failure-marker')",
        "a thrown config error",
        /^config-failure-marker$/
      ],
      ["module.exports = { mode: 'invalid-mode' }", "invalid options", /option 'mode' is invalid/]
    ] as const) {
      it(`restores initialization after ${message}`, async ({ expect }) => {
        await withFiles(
          {
            "bad/.esmrc.js": source,
            "good/.esmrc.js": "module.exports = { mainFields: ['module', 'main'] }\n",
            ...Object.fromEntries(
              Object.entries(targetFiles).map(([name, code]) => [`good/${name}`, code])
            ),
            "retry.cjs": `const Module = require('node:module')
const path = require('node:path')
const loader = require(${JSON.stringify(loaderPath)})
function open(name) {
  const filename = path.join(__dirname, name, 'main.cjs')
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  return loader(mod)
}
try { open('bad') } catch (error) {
  console.log(error.message)
}
open('good')('./entry.js')
`
          },
          async (directory) => {
            const result = await runNode(["retry.cjs"], esmEnv, {}, { cwd: directory })
            expect(result.exitCode, result.stderr.slice(-4_000)).toBe(0)
            expect(result.stderr).toBe("")
            const lines = result.stdout.trim().split("\n")
            expect(lines).toHaveLength(2)
            expect(lines[0]).toMatch(expected)
            expect(lines[1]).toBe("module")
          }
        )
      })
    }
  })
}
