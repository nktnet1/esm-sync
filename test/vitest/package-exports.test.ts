import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it, type TestContext } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loaderPath = path.resolve(testPath, "../esm.js")

async function withFiles(files: Record<string, string>, run: (directory: string) => Promise<void>) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-exports-")))
  try {
    for (const [name, source] of Object.entries(files)) {
      const filename = path.join(directory, name)
      await mkdir(path.dirname(filename), { recursive: true })
      await writeFile(filename, source)
    }
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function output(expect: TestContext["expect"], result: Awaited<ReturnType<typeof runNode>>) {
  expect(result.exitCode, result.stderr.slice(-4_000)).toBe(0)
  expect(result.stderr).toBe("")
  return JSON.parse(result.stdout) as unknown
}

function packageFiles(name: string, exports: unknown, files: Record<string, string> = {}) {
  return Object.fromEntries(
    Object.entries({
      "package.json": JSON.stringify({ name, main: "./main.cjs", exports }),
      "main.cjs": "module.exports = 'legacy'\n",
      "out.cjs": "module.exports = 'target'\n",
      "space file.cjs": "module.exports = 'target'\n",
      "percent%.cjs": "module.exports = 'target'\n",
      "private.cjs": "module.exports = 'private'\n",
      ...files
    }).map(([filename, source]) => [`node_modules/${name}/${filename}`, source])
  )
}

const mappings: [string, unknown, string, string][] = [
  ["encoded-space", "./space%20file.cjs", "", "target"],
  ["encoded-percent", "./percent%25.cjs", "", "target"],
  ["blocked", { ".": "./out.cjs" }, "private.cjs", "ERR_PACKAGE_PATH_NOT_EXPORTED"],
  ["empty", {}, "", "ERR_PACKAGE_PATH_NOT_EXPORTED"],
  ["no-main", { "./public": "./out.cjs" }, "", "ERR_PACKAGE_PATH_NOT_EXPORTED"],
  ["null-entry", { ".": null, default: "./out.cjs" }, "", "ERR_INVALID_PACKAGE_CONFIG"],
  [
    "null-subpath",
    { "./*": "./out.cjs", "./private/*": null },
    "private/file",
    "ERR_PACKAGE_PATH_NOT_EXPORTED"
  ],
  ["condition-null", { node: null, default: "./out.cjs" }, "", "ERR_PACKAGE_PATH_NOT_EXPORTED"],
  ["unknown-condition", { browser: "./private.cjs", default: "./out.cjs" }, "", "target"],
  ["nested-fallback", { node: { browser: "./private.cjs" }, default: "./out.cjs" }, "", "target"],
  [
    "ordered-default",
    { default: "./out.cjs", require: "./private.cjs", import: "./private.cjs" },
    "",
    "target"
  ],
  ["array-invalid", ["outside", "./out.cjs"], "", "target"],
  ["array-null", [null, "./out.cjs"], "", "target"],
  ["array-invalid-null", ["outside", null], "", "ERR_PACKAGE_PATH_NOT_EXPORTED"],
  ["array-null-invalid", [null, "outside"], "", "ERR_INVALID_PACKAGE_TARGET"],
  ["array-empty", [], "", "ERR_PACKAGE_PATH_NOT_EXPORTED"],
  ["missing", "./absent.cjs", "", "MISSING"],
  ["array-missing", ["./absent.cjs", "./out.cjs"], "", "MISSING"],
  ["no-extension", "./out", "", "MISSING"],
  ["directory", "./folder", "", "DIRECTORY"],
  ["outside", "../out.cjs", "", "ERR_INVALID_PACKAGE_TARGET"],
  ["absolute", "/out.cjs", "", "ERR_INVALID_PACKAGE_TARGET"],
  ["traversal", "./folder/../out.cjs", "", "ERR_INVALID_PACKAGE_TARGET"],
  ["encoded-traversal", "./%2e%2e/out.cjs", "", "ERR_INVALID_PACKAGE_TARGET"],
  ["node-modules", "./node_modules/out.cjs", "", "ERR_INVALID_PACKAGE_TARGET"],
  ["encoded-separator", "./folder%2fout.cjs", "", "ERR_INVALID_MODULE_SPECIFIER"],
  ["bad-capture", { "./*": "./folder/*.cjs" }, "../out", "ERR_INVALID_MODULE_SPECIFIER"],
  ["encoded-capture", { "./*": "./folder/*.cjs" }, "%2e%2e/out", "ERR_INVALID_MODULE_SPECIFIER"],
  ["encoded-exact", { "./public": "./out.cjs" }, "%70ublic", "ERR_PACKAGE_PATH_NOT_EXPORTED"],
  ["numeric", { "0": "./out.cjs", default: "./out.cjs" }, "", "ERR_INVALID_PACKAGE_CONFIG"],
  ["mixed", { ".": "./out.cjs", node: "./out.cjs" }, "", "ERR_INVALID_PACKAGE_CONFIG"],
  ["invalid-value", { ".": false }, "", "ERR_INVALID_PACKAGE_TARGET"],
  [
    "exact-null",
    { "./*": "./out.cjs", "./private": null },
    "private",
    "ERR_PACKAGE_PATH_NOT_EXPORTED"
  ],
  ["specific", { "./*": "./private.cjs", "./feature/*.js": "./out.cjs" }, "feature/a.js", "target"],
  [
    "suffix",
    { "./feature/*": "./private.cjs", "./feature/*.js": "./out.cjs" },
    "feature/a.js",
    "target"
  ],
  ["@scope/mapped", { "./public": "./out.cjs" }, "public", "target"],
  ["null-map", null, "private.cjs", "private"]
]

for (const esmEnv of testEnvironments) {
  describe.concurrent(`package exports (${esmEnv})`, () => {
    it("separates import, require, and require.resolve in both cache orders", async ({
      expect
    }) => {
      const files = {
        ...packageFiles(
          "dual",
          {
            ".": { import: "./import.mjs", require: "./require.cjs" },
            "./cjs": { import: "./import.cjs", require: "./require.cjs" }
          },
          {
            "import.mjs": "export default 'import'; export const filename = import.meta.url\n",
            "import.cjs": "module.exports = 'import-cjs'\n",
            "require.cjs": "module.exports = 'require'\n"
          }
        ),
        "static.mjs": `import value, { filename } from 'dual'
import cjs from 'dual/cjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
export const values = [value, cjs, require('dual')]
export const resolved = [filename, require.resolve('dual')]
`,
        "native.cjs": `const load = require
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const requireFirst = process.argv[2] === 'require-first'
if (requireFirst) load('dual')
import('./static.mjs').then(esm => {
console.log(JSON.stringify([esm.values, load('dual'),
  esm.resolved.map(value => value.startsWith('file:') ? value : pathToFileURL(value).href),
  pathToFileURL(load.resolve('dual')).href]))
})
`,
        "factory.cjs": `const load = require(${JSON.stringify(loaderPath)})(module, { cjs: true })
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const requireFirst = process.argv[2] === 'require-first'
if (requireFirst) load('dual')
const esm = load('./static.mjs')
console.log(JSON.stringify([esm.values, load('dual'),
  esm.resolved.map(value => value.startsWith('file:') ? value : pathToFileURL(value).href),
  pathToFileURL(load.resolve('dual')).href]))
`
      }
      await withFiles(files, async (directory) => {
        for (const order of ["require-first", "import-first"]) {
          const native = output(
            expect,
            await runNode(["native.cjs", order], esmEnv, {}, { cwd: directory })
          )
          for (const args of [
            ["-r", loaderPath, "native.cjs", order],
            ["factory.cjs", order]
          ]) {
            const actual = output(expect, await runNode(args, esmEnv, {}, { cwd: directory }))
            expect(actual).toStrictEqual(native)
          }
          expect(native).toEqual([
            ["import", "import-cjs", "require"],
            "require",
            [expect.stringMatching(/\/import\.mjs$/), expect.stringMatching(/\/require\.cjs$/)],
            expect.stringMatching(/\/require\.cjs$/)
          ])
        }
      })
    })

    it("matches native target validation and prevents require fallbacks through exports", async ({
      expect
    }) => {
      const files: Record<string, string> = {}
      const requests: string[] = []
      for (const [name, exports, subpath] of mappings) {
        Object.assign(
          files,
          packageFiles(name, exports, {
            "folder/index.js": "module.exports = 'directory-fallback'\n"
          })
        )
        requests.push(name + (subpath ? "/" + subpath : ""))
      }
      const body = `const requests = ${JSON.stringify(requests)}
console.log(JSON.stringify(requests.map(request => {
  try { return load(request) } catch (error) { return error.code }
})))\n`
      files["native.cjs"] = "const load = require\n" + body
      files["factory.cjs"] =
        `const load = require(${JSON.stringify(loaderPath)})(module, {cjs:true})\n` + body
      await withFiles(files, async (directory) => {
        const native = output(expect, await runNode(["native.cjs"], esmEnv, {}, { cwd: directory }))
        expect(native).toStrictEqual(
          mappings.map(([, , , value]) =>
            value === "MISSING" || value === "DIRECTORY" ? "MODULE_NOT_FOUND" : value
          )
        )
        for (const args of [["factory.cjs"], ["-r", loaderPath, "native.cjs"]]) {
          expect(output(expect, await runNode(args, esmEnv, {}, { cwd: directory }))).toStrictEqual(
            native
          )
        }
      })
    })

    for (const cjs of [true, false]) {
      it(`matches dynamic import validation with cjs.paths=${cjs}`, async ({ expect }) => {
        const files: Record<string, string> = {}
        const requests: string[] = []
        for (const [name, exports, subpath] of mappings) {
          Object.assign(
            files,
            packageFiles(name, exports, {
              "folder/index.js": "module.exports = 'directory-fallback'\n"
            })
          )
          requests.push(name + (subpath ? "/" + subpath : ""))
        }
        files["dynamic.mjs"] = `Promise.all(${JSON.stringify(requests)}.map(request =>
  import(request).then(value => value.default, error => error.code)
)).then(values => console.log(JSON.stringify(values)))\n`
        await withFiles(files, async (directory) => {
          const native = output(
            expect,
            await runNode(["dynamic.mjs"], esmEnv, {}, { cwd: directory })
          )
          expect(native).toStrictEqual(
            mappings.map(([, , , value]) =>
              value === "MISSING"
                ? "ERR_MODULE_NOT_FOUND"
                : value === "DIRECTORY"
                  ? "ERR_UNSUPPORTED_DIR_IMPORT"
                  : value
            )
          )
          expect(
            output(
              expect,
              await runNode(
                ["-r", loaderPath, "dynamic.mjs"],
                esmEnv,
                { ESM_OPTIONS: JSON.stringify({ cjs, mode: "auto" }) },
                { cwd: directory }
              )
            )
          ).toStrictEqual(native)
        })
      })
    }

    it("does not switch a missing static import to a working require condition", async ({
      expect
    }) => {
      await withFiles(
        {
          ...packageFiles("missing-import", { import: "./absent.mjs", require: "./out.cjs" }),
          "index.mjs": "import value from 'missing-import'; console.log(value)\n",
          "report.cjs":
            "process.on('uncaughtException', error => { console.log(error.code); process.exitCode = 1 })\n"
        },
        async (directory) => {
          for (const args of [
            ["-r", "./report.cjs", "index.mjs"],
            ["-r", "./report.cjs", "-r", loaderPath, "index.mjs"]
          ]) {
            const result = await runNode(args, esmEnv, {}, { cwd: directory })
            expect(result.exitCode, result.stderr.slice(-4_000)).toBe(1)
            expect(result.stdout.trim()).toBe("ERR_MODULE_NOT_FOUND")
          }
        }
      )
    })

    it("resolves self references and blocks their private subpaths", async ({ expect }) => {
      const body = `const result = [require('self')]
try { require('self/private.cjs') } catch (error) { result.push(error.code) }
console.log(JSON.stringify(result))\n`
      await withFiles(
        {
          "package.json": JSON.stringify({ name: "self", exports: { ".": "./out.cjs" } }),
          "out.cjs": "module.exports = 'self'\n",
          "private.cjs": "module.exports = 'private'\n",
          "index.cjs": body,
          "factory.cjs":
            `const require2 = require(${JSON.stringify(loaderPath)})(module, {cjs:true})\n` +
            body.replace(/require\(/g, "require2(")
        },
        async (directory) => {
          for (const args of [["index.cjs"], ["-r", loaderPath, "index.cjs"], ["factory.cjs"]]) {
            expect(
              output(expect, await runNode(args, esmEnv, {}, { cwd: directory }))
            ).toStrictEqual(["self", "ERR_PACKAGE_PATH_NOT_EXPORTED"])
          }
        }
      )
    })

    it("supports legacy folder remapping and uses the most specific public mapping", async ({
      expect
    }) => {
      const files = {
        "index.js": "export const root = 'root'\n",
        "Foo.js": "export const Foo = 'foo'\n",
        "nested/Bar.js": "export const Bar = 'bar'\n",
        "private/secret.js": "export const secret = 'secret'\n"
      }
      const fixtures: Record<string, string> = {}
      for (const name of ["legacy", "modern"]) {
        fixtures[`node_modules/${name}/package.json`] = JSON.stringify({
          name,
          type: "module",
          exports:
            name === "legacy"
              ? { ".": "./dist/index.js", "./": "./dist/", "./private/": null }
              : { ".": "./dist/index.js", "./*": "./dist/*", "./private/*": null }
        })
        for (const [filename, source] of Object.entries(files))
          fixtures[`node_modules/${name}/dist/${filename}`] = source
        fixtures[`${name}.mjs`] = `import { root } from '${name}'
import { Foo } from '${name}/Foo.js'
import { Bar } from '${name}/nested/Bar.js'
import('${name}/private/secret.js').catch(error => console.log(JSON.stringify([root, Foo, Bar, error.code])))\n`
      }
      await withFiles(fixtures, async (directory) => {
        const expected = output(
          expect,
          await runNode(["modern.mjs"], esmEnv, {}, { cwd: directory })
        )
        expect(expected).toStrictEqual(["root", "foo", "bar", "ERR_PACKAGE_PATH_NOT_EXPORTED"])
        for (const name of ["modern", "legacy"]) {
          expect(
            output(
              expect,
              await runNode(["-r", loaderPath, name + ".mjs"], esmEnv, {}, { cwd: directory })
            )
          ).toStrictEqual(expected)
        }
      })
    })

    it("uses host and custom conditions from CLI flags and NODE_OPTIONS", async ({ expect }) => {
      const exports = {
        development: "./development.cjs",
        "node-addons": "./addons.cjs",
        "module-sync": "./sync.cjs",
        node: "./out.cjs"
      }
      await withFiles(
        {
          ...packageFiles("conditions", exports, {
            "development.cjs": "module.exports = 'development'\n",
            "addons.cjs": "module.exports = 'addons'\n",
            "sync.cjs": "module.exports = 'sync'\n"
          }),
          "index.cjs":
            "const result = [require('conditions')]; import('conditions').then(value => console.log(JSON.stringify([...result, value.default])))\n"
        },
        async (directory) => {
          for (const flags of [
            [],
            ["--no-addons"],
            ["--no-addons", "--addons"],
            ["--addons", "--no-addons"],
            ["--no-addons", "--no-experimental-require-module"],
            ["--conditions=development"],
            ["-C", "development"]
          ]) {
            const native = output(
              expect,
              await runNode([...flags, "index.cjs"], esmEnv, {}, { cwd: directory })
            )
            expect(
              output(
                expect,
                await runNode(
                  [...flags, "-r", loaderPath, "index.cjs"],
                  esmEnv,
                  {},
                  { cwd: directory }
                )
              )
            ).toStrictEqual(native)
          }
          const env = { NODE_OPTIONS: "--conditions=development" }
          const native = output(
            expect,
            await runNode(["index.cjs"], esmEnv, env, { cwd: directory })
          )
          expect(
            output(
              expect,
              await runNode(["-r", loaderPath, "index.cjs"], esmEnv, env, { cwd: directory })
            )
          ).toStrictEqual(native)
        }
      )
    })

    it("matches native symlink resolution with and without preservation", async ({ expect }) => {
      await withFiles(
        {
          "actual/package.json": JSON.stringify({ name: "linked", exports: { ".": "./out.cjs" } }),
          "actual/out.cjs": "module.exports = __filename\n",
          "node_modules/placeholder": "",
          "index.cjs":
            "console.log(JSON.stringify([require('linked'), require.resolve('linked')]))\n"
        },
        async (directory) => {
          await symlink(
            path.join(directory, "actual"),
            path.join(directory, "node_modules/linked"),
            "junction"
          )
          for (const flags of [[], ["--preserve-symlinks"]]) {
            const native = output(
              expect,
              await runNode([...flags, "index.cjs"], esmEnv, {}, { cwd: directory })
            )
            expect(
              output(
                expect,
                await runNode(
                  [...flags, "-r", loaderPath, "index.cjs"],
                  esmEnv,
                  {},
                  { cwd: directory }
                )
              )
            ).toStrictEqual(native)
          }
        }
      )
    })
  })
}
