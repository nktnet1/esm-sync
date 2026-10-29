import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, it, type TestContext } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"
import {
  coverageLoader,
  coverageFor,
  runCoverage,
  tsNodeRegister,
  mochaCLI,
  babelRegister,
  babelPreset,
  withCompatibilityFiles,
  type FileCoverage
} from "./helpers/coverage.ts"

const source = `export function covered(value) {
  if (value) return 'yes'
  return 'no'
}
export function unused() { return 'unused' }
`
const options = { ESM_OPTIONS: "{cjs:true,mode:'auto',cache:'./esm-cache'}" }
const coverageTestTimeout = 180_000

function checkCoverage(expect: TestContext["expect"], file: FileCoverage | undefined) {
  expect.assert(file, "Expected coverage for the original source file")
  const functions = Object.entries(file.fnMap).map(([id, fn]) => [
    fn.name,
    file.f[id],
    fn.loc.start.line
  ])
  expect(functions).toStrictEqual([
    ["covered", 1, 1],
    ["unused", 0, 5]
  ])
  const ifBranch = Object.entries(file.branchMap).find(([, branch]) => branch.type === "if")
  expect.assert(ifBranch)
  expect(ifBranch[1].line).toBe(2)
  expect(file.b[ifBranch[0]]).toStrictEqual([1, 0])
  const uncoveredLines = Object.entries(file.statementMap)
    .filter(([id]) => file.s[id] === 0)
    .map(([, location]) => location.start.line)
  expect(uncoveredLines).toContain(3)
  expect(uncoveredLines).toContain(5)
}

for (const esmEnv of testEnvironments) {
  // NYC, Babel and ts-node each start nested Node processes. Serialising these
  // cases avoids CPU starvation on macOS and Windows CI runners.
  describe(`coverage and persistent caches (${esmEnv})`, () => {
    it(
      "composes Babel and NYC transforms with native Module compilation checks",
      async (context) => {
        const expect: TestContext["expect"] = context.expect
        await withCompatibilityFiles(
          {
            "host.cjs": "global.HostModule = require('node:module')\n",
            ".babelrc.js": `module.exports = { presets: [[${JSON.stringify(babelPreset)}, { modules: false, targets: { node: '10' } }]] }\n`,
            "get.js": `if (!(module instanceof global.HostModule)) throw new Error('Expected a native Module instance')
async function* values() { yield 'a'; yield 'b' }
export default async () => {
  const result = []
  for await (const value of values()) result.push(value)
  return result
}
`,
            "test.js":
              "import { deepStrictEqual } from 'node:assert'; import get from './get.js'; it('collects values', async () => deepStrictEqual(await get(), ['a', 'b']))\n"
          },
          async (directory) => {
            const result = await runCoverage(directory, esmEnv, {
              entry: mochaCLI,
              include: "get.js",
              preloads: [path.join(directory, "host.cjs"), babelRegister, coverageLoader],
              args: ["--reporter=dot", "test.js"]
            })
            expect(result.exitCode, result.stderr || result.stdout).toBe(0)
            const file = await coverageFor(result.coverage, path.join(directory, "get.js"))
            expect.assert(file)
            expect(Object.values(file.f).some((count) => count > 0)).toBe(true)
          }
        )
      },
      coverageTestTimeout
    )

    for (const extension of ["js", "mjs"]) {
      it(
        `preserves real .${extension} coverage across normal, instrumented, and warm runs`,
        async ({ expect }) => {
          await withCompatibilityFiles(
            {
              [`math.${extension}`]: source,
              [`index.${extension}`]: `import { covered } from './math.${extension}'
console.log(covered(true) + ':' + (typeof globalThis.__coverage__ === 'object' ? 'instrumented' : 'plain'))
`
            },
            async (directory) => {
              const filename = `index.${extension}`
              const runPlain = () =>
                runNode(["-r", coverageLoader, filename], esmEnv, options, { cwd: directory })
              const first = await runPlain()
              expect(first.exitCode, first.stderr).toBe(0)
              expect(first.stdout).toBe("yes:plain\n")
              for (const phase of ["cold", "warm"]) {
                const result = await runCoverage(directory, esmEnv, {
                  entry: filename,
                  include: `math.${extension}`,
                  report: "coverage"
                })
                expect(result.exitCode, phase + ": " + result.stderr).toBe(0)
                expect(result.stdout).toBe("yes:instrumented\n")
                checkCoverage(
                  expect,
                  await coverageFor(result.coverage, path.join(directory, `math.${extension}`))
                )
              }
              const excluded = await runCoverage(directory, esmEnv, {
                entry: filename,
                include: "unrelated.js"
              })
              expect(excluded.exitCode, excluded.stderr).toBe(0)
              expect(excluded.stdout).toBe("yes:plain\n")
              expect(excluded.coverage).toStrictEqual({})
              const restored = await runCoverage(directory, esmEnv, {
                entry: filename,
                include: `math.${extension}`
              })
              expect(restored.exitCode, restored.stderr).toBe(0)
              expect(restored.stdout).toBe("yes:instrumented\n")
              checkCoverage(
                expect,
                await coverageFor(restored.coverage, path.join(directory, `math.${extension}`))
              )
              const last = await runPlain()
              expect(last.exitCode, last.stderr).toBe(0)
              expect(last.stdout).toBe(first.stdout)
              expect(last.stderr).toBe("")
            }
          )
        },
        coverageTestTimeout
      )
    }

    for (const module of ["CommonJS", "ESNext"]) {
      it(
        `keeps ts-node ${module} function exports callable under NYC and Mocha`,
        async (context) => {
          const expect: TestContext["expect"] = context.expect
          await withCompatibilityFiles(
            {
              "calc.ts":
                "export const calc = (value: number): number => value + 1\nexport const unused = (): number => 0\n",
              "calc.test.ts":
                "import { strictEqual } from 'node:assert'\nimport { calc } from './calc'\ndescribe('calc', () => { it('adds one', () => strictEqual(calc(41), 42)) })\n"
            },
            async (directory) => {
              const result = await runCoverage(directory, esmEnv, {
                entry: mochaCLI,
                include: "calc.ts",
                preloads: [tsNodeRegister, coverageLoader],
                args: ["--reporter=dot", "calc.test.ts"],
                env: {
                  TS_NODE_TRANSPILE_ONLY: "true",
                  TS_NODE_SKIP_PROJECT: "true",
                  TS_NODE_COMPILER_OPTIONS: JSON.stringify({
                    module,
                    moduleResolution: module === "ESNext" ? "Bundler" : "Node",
                    target: "ES2022"
                  })
                }
              })
              expect(result.exitCode, result.stderr || result.stdout).toBe(0)
              const file = await coverageFor(result.coverage, path.join(directory, "calc.ts"))
              expect.assert(file, "Expected source-mapped TypeScript coverage")
              expect(Object.values(file.f).sort()).toStrictEqual([0, 1])
              expect(
                Object.values(file.statementMap).every((location) => location.start.line <= 2)
              ).toBe(true)
            }
          )
        },
        coverageTestTimeout
      )
    }

    it("bypasses an existing compiler cache without deleting it when ESM_DISABLE_CACHE is true", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "value.mjs": "export default 'source'\n",
          "index.js": "import value from './value.mjs'; console.log(value)\n"
        },
        async (directory) => {
          const first = await runNode(["-r", coverageLoader, "index.js"], esmEnv, options, {
            cwd: directory
          })
          expect(first.exitCode, first.stderr).toBe(0)
          const cache = path.join(directory, "esm-cache")
          const files = await readdir(cache)
          expect(files.some((file) => /^[a-f0-9]{16}\.js$/.test(file))).toBe(true)
          for (const file of files.filter((file) => file.endsWith(".js")))
            await writeFile(path.join(cache, file), "throw new Error('stale-compiler-cache')\n")
          const before = await Promise.all(
            files.map(async (file) => [file, await readFile(path.join(cache, file), "base64")])
          )
          const result = await runNode(
            ["-r", coverageLoader, "index.js"],
            esmEnv,
            { ...options, ESM_DISABLE_CACHE: "true" },
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stdout).toBe("source\n")
          expect(await readdir(cache)).toStrictEqual(files)
          expect(
            await Promise.all(
              files.map(async (file) => [file, await readFile(path.join(cache, file), "base64")])
            )
          ).toStrictEqual(before)
        }
      )
    })

    it("honors boolean cache-disable values before creating persistent caches", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "value.mjs": "export default 42\n",
          "index.js": "import value from './value.mjs'; console.log(value)\n"
        },
        async (directory) => {
          for (const [value, disabled] of [
            ["true", true],
            ["1", true],
            ["false", false],
            ["0", false],
            ["invalid", false]
          ] as const) {
            const cache = path.join(directory, `cache-${value}`)
            const result = await runNode(
              ["-r", coverageLoader, "index.js"],
              esmEnv,
              {
                ESM_OPTIONS: JSON.stringify({ cjs: true, mode: "auto", cache }),
                ESM_DISABLE_CACHE: value
              },
              { cwd: directory }
            )
            expect(result.exitCode, result.stderr).toBe(0)
            expect(result.stdout).toBe("42\n")
            expect(
              await stat(cache).then(
                () => true,
                () => false
              )
            ).toBe(!disabled)
          }
        }
      )
    })

    it("disables bootstrap persistence as well as the package compiler cache", async ({
      expect
    }) => {
      const files = {
        "package.json": await readFile(
          path.join(path.dirname(coverageLoader), "../package.json"),
          "utf8"
        ),
        "dist/esm.js": await readFile(coverageLoader, "utf8"),
        "dist/esm/loader.js": await readFile(
          path.join(path.dirname(coverageLoader), "esm/loader.js"),
          "utf8"
        ),
        "value.mjs": "export default 42\n",
        "index.js": "import value from './value.mjs'; console.log(value)\n"
      }
      await withCompatibilityFiles(files, async (directory) => {
        const result = await runNode(
          ["-r", path.join(directory, "dist/esm.js"), "index.js"],
          esmEnv,
          {
            ESM_OPTIONS: JSON.stringify({ cjs: true, mode: "auto", cache: "./app-cache" }),
            ESM_DISABLE_CACHE: "true"
          },
          { cwd: directory }
        )
        expect(result.exitCode, result.stderr).toBe(0)
        expect(result.stdout).toBe("42\n")
        for (const cache of ["app-cache", "node_modules/.cache/esm"]) {
          expect(
            await stat(path.join(directory, cache)).then(
              () => true,
              () => false
            )
          ).toBe(false)
        }
      })
    })
  })
}

it("locates Istanbul coverage by canonical file identity, including file URLs", async ({
  expect
}) => {
  await withCompatibilityFiles(
    { "source.ts": "export const value = 42\n", "other.ts": "export const value = 0\n" },
    async (directory) => {
      const filename = await realpath(path.join(directory, "source.ts"))
      const file: FileCoverage = {
        path: filename,
        fnMap: {},
        f: {},
        branchMap: {},
        b: {},
        statementMap: {},
        s: {}
      }
      // Istanbul's source-map paths may have a different spelling even when
      // they refer to the same actual file on a case-insensitive filesystem.
      const alternate =
        process.platform === "win32"
          ? filename.replaceAll("\\", "/")
          : path.join(directory, "subdirectory", "..", "source.ts")
      expect(await coverageFor({ [alternate]: file }, filename)).toBe(file)
      expect(await coverageFor({ [pathToFileURL(filename).href]: file }, filename)).toBe(file)
      await expect(
        coverageFor({ [alternate]: file }, path.join(directory, "other.ts"))
      ).rejects.toThrow(/NYC did not report coverage/)
    }
  )
})
