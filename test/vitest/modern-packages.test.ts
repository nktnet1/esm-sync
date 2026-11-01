import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, it, type TestContext } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loaderPath = path.resolve(testPath, "../esm.js")
type Files = Record<string, string>

async function withFiles(files: Files, run: (directory: string) => Promise<void>) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-modern-")))
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
  expect(result.exitCode, result.stderr || result.stdout).toBe(0)
  expect(result.stderr).toBe("")
  return JSON.parse(result.stdout) as unknown
}

async function compare(
  expect: TestContext["expect"],
  directory: string,
  esmEnv: string,
  entry: string,
  flags: string[] = []
) {
  const native = output(expect, await runNode([...flags, entry], esmEnv, {}, { cwd: directory }))
  for (const cache of [false, path.join(directory, "cache")]) {
    const options = { ESM_OPTIONS: JSON.stringify({ cjs: true, cache }) }
    // Reuse the same disk cache for the second process: cold then warm.
    for (let attempt = 0; attempt < (cache === false ? 1 : 2); attempt++) {
      expect(
        output(
          expect,
          await runNode([...flags, "-r", loaderPath, entry], esmEnv, options, { cwd: directory })
        )
      ).toStrictEqual(native)
    }
  }
  return native
}

for (const esmEnv of testEnvironments) {
  describe.concurrent(`modern package imports and metadata (${esmEnv})`, () => {
    it("separates import and require conditions, including factory require.resolve", async ({
      expect
    }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({
            type: "module",
            imports: { "#value": { import: "./import.mjs", require: "./require.cjs" } }
          }),
          "import.mjs": "export default 'import'; export const url = import.meta.url\n",
          "require.cjs": "module.exports = 'require'\n",
          "entry.mjs": `import value from '#value'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
console.log(JSON.stringify([value, (await import('#value')).default, require('#value'), require.resolve('#value')]))\n`,
          "entry.cjs": `import('#value').then(ns => console.log(JSON.stringify([ns.default, require('#value'), require.resolve('#value')])) )\n`,
          "factory.cjs": `const load = require(${JSON.stringify(loaderPath)})(module)
console.log(JSON.stringify([load('#value'), load.resolve('#value')]))\n`
        },
        async (directory) => {
          await compare(expect, directory, esmEnv, "entry.mjs")
          const native = (await compare(expect, directory, esmEnv, "entry.cjs")) as unknown[]
          const factory = output(
            expect,
            await runNode(["factory.cjs"], esmEnv, {}, { cwd: directory })
          )
          expect(factory).toStrictEqual(native.slice(1))
        }
      )
    })

    it("loads explicit .js mappings from .mjs and shares live bindings with dynamic imports", async ({
      expect
    }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({
            type: "module",
            imports: { "#counter": "./counter.js", "#export": "./reexport.mjs" }
          }),
          "counter.js":
            "export let value = 0; export function increment() { value++ }; export function current() { return import('./counter.js') }\n",
          "reexport.mjs": "export { value, increment } from '#counter'\n",
          "entry.mjs": `import { value, increment } from '#export'
increment()
const ns = await import('#counter')
console.log(JSON.stringify([value, ns.value, ns.increment === (await ns.current()).increment]))\n`
        },
        async (directory) => {
          expect(await compare(expect, directory, esmEnv, "entry.mjs")).toStrictEqual([1, 1, true])
        }
      )
    })

    it("preserves mapped URL identity, encoded filenames and empty query or fragment suffixes", async ({
      expect
    }) => {
      const imports = {
        "#plain": "./value.mjs",
        "#query": "./value.mjs?x=1",
        "#fragment": "./value.mjs#part",
        "#empty-query": "./value.mjs?",
        "#empty-fragment": "./value.mjs#",
        "#encoded": "./space%20%23%25.mjs"
      }
      await withFiles(
        {
          "package.json": JSON.stringify({ type: "module", imports }),
          "value.mjs": "export const url = import.meta.url; export default {}\n",
          "space #%.mjs": "export default 'encoded'\n",
          "entry.mjs": `const pairs = [['#plain','./value.mjs'],['#query','./value.mjs?x=1'],['#fragment','./value.mjs#part'],['#empty-query','./value.mjs'],['#empty-fragment','./value.mjs']]
const result = []
for (const [alias, target] of pairs) {
  const a = await import(alias), b = await import(target)
  result.push([a === b, a.url, import.meta.resolve(alias)])
}
result.push((await import('#encoded')).default)
console.log(JSON.stringify(result))\n`
        },
        async (directory) => {
          await compare(expect, directory, esmEnv, "entry.mjs")
        }
      )
    })

    it("supports pattern specificity, arrays, nested conditions, builtins and external packages", async ({
      expect
    }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({
            name: "self",
            type: "module",
            exports: "./external.mjs",
            imports: {
              "#features/*": "./features/*.mjs",
              "#features/special/*": "./special/*.mjs",
              "#array": ["../bad.mjs", null, { browser: "./bad.mjs" }, "./external.mjs"],
              "#nested": { node: { browser: "./bad.mjs" }, default: "./external.mjs" },
              "#builtin": "fs",
              "#dependency": "dependency",
              "#self": "self"
            }
          }),
          "external.mjs": "export default 'external'\n",
          "features/a.mjs": "export default 'feature'\n",
          "special/a.mjs": "export default 'specific'\n",
          "node_modules/dependency/package.json": JSON.stringify({
            type: "module",
            exports: { import: "./import.mjs", require: "./require.cjs" }
          }),
          "node_modules/dependency/import.mjs": "export default 'dependency-import'\n",
          "node_modules/dependency/require.cjs": "module.exports = 'dependency-require'\n",
          "entry.mjs": `import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), result = []
for (const name of ['#features/a','#features/special/a','#array','#nested','#dependency','#self']) result.push((await import(name)).default)
result.push(typeof (await import('#builtin')).readFile, require('#dependency'))
console.log(JSON.stringify(result))\n`
        },
        async (directory) => {
          await compare(expect, directory, esmEnv, "entry.mjs")
        }
      )
    })

    it("uses the owning package for private mappings and external dependencies", async ({
      expect
    }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({
            type: "module",
            imports: { "#value": "./root.mjs", "#dep": "dep" }
          }),
          "root.mjs": "export default 'root'\n",
          "nested/package.json": JSON.stringify({ type: "module" }),
          "nested/child.mjs":
            "try { await import('#value') } catch (error) { exportError = error.code }; var exportError; export { exportError as default }\n",
          "node_modules/unmapped/index.mjs":
            "try { await import('#value') } catch (error) { exportError = error.code }; var exportError; export { exportError as default }\n",
          "node_modules/dep/package.json": JSON.stringify({ exports: "./value.cjs" }),
          "node_modules/dep/value.cjs": "module.exports = 'root-dependency'\n",
          "deep/node_modules/dep/package.json": JSON.stringify({ exports: "./value.cjs" }),
          "deep/node_modules/dep/value.cjs": "module.exports = 'wrong-dependency'\n",
          "deep/entry.mjs": `import value from '#value'; import dependency from '#dep'
const nested = await import('../nested/child.mjs'), unmapped = await import('../node_modules/unmapped/index.mjs')
console.log(JSON.stringify([value, dependency, nested.default, unmapped.default]))\n`
        },
        async (directory) => {
          await compare(expect, directory, esmEnv, "deep/entry.mjs")
        }
      )
    })

    it("matches native errors and does not fall back after selected missing or blocked targets", async ({
      expect
    }) => {
      const imports = {
        "#blocked": null,
        "#directory": "./folder",
        "#missing": "./absent.mjs",
        "#extension": "./value",
        "#array-missing": ["./absent.mjs", "./value.mjs"],
        "#outside": "../value.mjs",
        "#absolute": "/value.mjs",
        "#url": "file:///value.mjs",
        "#node-url": "node:fs",
        "#traversal": "./a/../value.mjs",
        "#encoded": "./%2e%2e/value.mjs",
        "#node-modules": "./node_modules/value.mjs",
        "#separator": "./a%2fvalue.mjs",
        "#numeric": { "0": "./value.mjs" },
        "#capture/*": "./folder/*.mjs",
        "#external": "missing-dependency",
        "#alias": "#undefined",
        "#invalid": false,
        "#backslash": "\\outside",
        "#dot-backslash": ".\\value.mjs",
        "#dot": ".",
        "#percent-name": "invalid%20name",
        "#scope-name": "@invalid",
        "#empty-array": []
      }
      const names = [
        "#",
        "#/bad",
        "#undefined",
        ...Object.keys(imports).filter((x) => !x.includes("*")),
        "#capture/../value"
      ]
      const body = `const result = []
for (const name of ${JSON.stringify(names)}) {
  try { result.push(['import', name, (await import(name)).default]) } catch(error) { result.push(['import', name, error.code]) }
  try { result.push(['require', name, require(name)]) } catch(error) { result.push(['require', name, error.code]) }
}
console.log(JSON.stringify(result))\n`
      await withFiles(
        {
          "package.json": JSON.stringify({ type: "module", imports }),
          "value.mjs": "export default 'unexpected-fallback'\n",
          "value.cjs": "module.exports = 'unexpected-fallback'\n",
          "folder/index.js": "export default 'unexpected-index'\n",
          "entry.cjs": `(async () => { ${body} })().catch(error => {console.error(error); process.exitCode = 1})\n`,
          "entry.mjs":
            `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url)\n` +
            body
        },
        async (directory) => {
          await compare(expect, directory, esmEnv, "entry.mjs")
          await compare(expect, directory, esmEnv, "entry.cjs")
        }
      )
    })

    it("honours custom, node-addons and module-sync conditions", async ({ expect }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({
            type: "module",
            imports: {
              "#value": {
                development: "./development.cjs",
                "node-addons": "./addons.cjs",
                "module-sync": "./sync.cjs",
                node: "./node.cjs"
              }
            }
          }),
          ...Object.fromEntries(
            ["development", "addons", "sync", "node"].map((name) => [
              name + ".cjs",
              `module.exports = '${name}'\n`
            ])
          ),
          "entry.mjs":
            "console.log(JSON.stringify([(await import('#value')).default, import.meta.resolve('#value')]))\n"
        },
        async (directory) => {
          for (const flags of [
            [],
            ["--conditions=development"],
            ["--no-addons"],
            ["--no-addons", "--no-experimental-require-module"]
          ])
            await compare(expect, directory, esmEnv, "entry.mjs", flags)
        }
      )
    })

    it("provides stable writable metadata, entry-point flags and a detached lexical resolver", async ({
      expect
    }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({ type: "module" }),
          "child.mjs": "export default import.meta\n",
          "entry.mjs": `import child from './child.mjs'
const meta = import.meta, resolve = meta.resolve
const original = meta.url
meta.url = 'file:///changed/entry.mjs'
const value = resolve.call(null, './child.mjs')
const descriptors = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(meta)).map(([key, descriptor]) => [key, [descriptor.writable, descriptor.enumerable, descriptor.configurable]]))
console.log(JSON.stringify([Object.getPrototypeOf(meta) === null, meta === import.meta, meta.filename, meta.dirname, meta.main, child.main, value, original, Object.keys(meta).sort(), descriptors, resolve.name, resolve.length, Object.hasOwn(resolve, 'prototype'), resolve instanceof Function]))\n`,
          "factory.cjs": `const load = require(${JSON.stringify(loaderPath)})(module); console.log(JSON.stringify(load('./child.mjs').default.main))\n`
        },
        async (directory) => {
          const result = (await compare(expect, directory, esmEnv, "entry.mjs")) as unknown[]
          expect(result.slice(4, 6)).toStrictEqual([true, false])
          expect(result[2]).toBe(await realpath(path.join(directory, "entry.mjs")))
          expect(
            output(expect, await runNode(["factory.cjs"], esmEnv, {}, { cwd: directory }))
          ).toBe(false)
        }
      )
    })

    it("resolves files, directories, aliases, public exports and URLs without loading them", async ({
      expect
    }) => {
      const requests = [
        "./absent.mjs",
        "./throws.mjs",
        "./directory/",
        "./space%20file.mjs?x=1#part",
        "#value",
        "#missing",
        "#folder",
        "#external",
        "public",
        "public/missing",
        "public/blocked",
        "fs",
        "node:fs",
        "node:missing",
        "data:text/javascript,export default 1",
        "https://example.com/module.mjs",
        "./bad%2fpath.mjs",
        "file://example.invalid/value.mjs"
      ]
      await withFiles(
        {
          "package.json": JSON.stringify({
            type: "module",
            imports: {
              "#value": "./throws.mjs?alias",
              "#missing": "./absent.mjs",
              "#folder": "./directory",
              "#external": "public/missing"
            }
          }),
          "throws.mjs": "throw new Error('resolver must not execute this')\n",
          "directory/placeholder": "",
          "space file.mjs": "export default 1\n",
          "node_modules/public/package.json": JSON.stringify({
            type: "module",
            exports: { ".": "./throws.mjs", "./missing": "./missing.mjs", "./blocked": null }
          }),
          "node_modules/public/throws.mjs":
            "throw new Error('resolver must not execute package')\n",
          "entry.mjs": `console.log(JSON.stringify(${JSON.stringify(requests)}.map(request => {try { return import.meta.resolve(request) } catch(error) { return error.code } })))\n`
        },
        async (directory) => {
          const result = (await compare(expect, directory, esmEnv, "entry.mjs")) as string[]
          // The target is absent: canonicalise its existing parent instead.
          expect(result[0]).toBe(
            pathToFileURL(path.join(await realpath(directory), "absent.mjs")).href
          )
        }
      )
    })

    it("coerces resolve arguments with the string hint and preserves thrown values", async ({
      expect
    }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({ type: "module" }),
          "entry.mjs": `const hints = [], marker = {}, resolve = import.meta.resolve, result = []
for (const value of [undefined, null, 7, true, Symbol('x'), { [Symbol.toPrimitive](hint) { hints.push(hint); return './missing.mjs' } }]) {
  try { result.push(resolve(value)) } catch(error) { result.push([error.name, error.code || null, error instanceof TypeError]) }
}
try { resolve({toString() { throw marker }}) } catch (error) { result.push(error === marker) }
console.log(JSON.stringify([result, hints]))\n`
        },
        async (directory) => {
          await compare(expect, directory, esmEnv, "entry.mjs")
        }
      )
    })

    it("shares URL identity across private aliases, public exports and direct URL imports", async ({
      expect
    }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({ type: "module", imports: { "#external": "exported" } }),
          "node_modules/exported/package.json": JSON.stringify({
            type: "module",
            exports: "./value.mjs?version=1#part"
          }),
          "node_modules/exported/value.mjs":
            "export const url = import.meta.url; export default {}\n",
          "entry.mjs": `const alias = await import('#external'), exported = await import('exported'), direct = await import('./node_modules/exported/value.mjs?version=1#part')
console.log(JSON.stringify([alias === exported, exported === direct, alias.url, import.meta.resolve('#external'), import.meta.resolve('exported')]))\n`
        },
        async (directory) => {
          await compare(expect, directory, esmEnv, "entry.mjs")
        }
      )
    })

    it("stops metadata resolution at a nearer package without exports", async ({ expect }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({ type: "module" }),
          "node_modules/dependency/package.json": JSON.stringify({ exports: "./root.cjs" }),
          "node_modules/dependency/root.cjs": "module.exports = 'wrong-package'\n",
          "nested/node_modules/dependency/package.json": JSON.stringify({ main: "local.cjs" }),
          "nested/node_modules/dependency/local.cjs": "module.exports = 'nearer-package'\n",
          "nested/entry.mjs":
            "console.log(JSON.stringify([import.meta.resolve('dependency'), (await import('dependency')).default]))\n"
        },
        async (directory) => {
          await compare(expect, directory, esmEnv, "nested/entry.mjs")
        }
      )
    })

    it("uses native empty-suffix identities with and without realpath preservation", async ({
      expect
    }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({
            type: "module",
            imports: {
              "#empty": "./value.mjs?",
              "#hash": "./value.mjs#",
              "#mixed": "./value.mjs?#part"
            }
          }),
          "value.mjs": "export const url = import.meta.url\n",
          "entry.mjs": `const plain = await import('./value.mjs'), result = []
for (const [alias,target] of [['#empty','./value.mjs?'],['#hash','./value.mjs#'],['#mixed','./value.mjs?#part']]) {
const a = await import(alias), b = await import(target)
result.push([a === b, a === plain, a.url, import.meta.resolve(alias)])
}
console.log(JSON.stringify(result))\n`
        },
        async (directory) => {
          for (const flags of [[], ["--preserve-symlinks"]])
            await compare(expect, directory, esmEnv, "entry.mjs", flags)
        }
      )
    })

    it("supports JSON attributes through private mappings", async ({ expect }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({ type: "module", imports: { "#json": "./value.json" } }),
          "value.json": JSON.stringify({ value: 42 }),
          "entry.mjs": `import value from '#json' with {type:'json'}
console.log(JSON.stringify([value.value, (await import('#json', {with:{type:'json'}})).default === value]))\n`
        },
        async (directory) => {
          await compare(expect, directory, esmEnv, "entry.mjs")
        }
      )
    })

    it("retains ordinary require behavior when no private map exists", async ({ expect }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({ type: "commonjs" }),
          "node_modules/#literal/package.json": JSON.stringify({ main: "value.cjs" }),
          "node_modules/#literal/value.cjs": "module.exports = 'literal-package'\n",
          "entry.cjs":
            "console.log(JSON.stringify([require('#literal'), require.resolve('#literal')]))\n"
        },
        async (directory) => {
          await compare(expect, directory, esmEnv, "entry.cjs")
        }
      )
    })

    it("keeps package loading and metadata usable without the WHATWG URL constructor", async ({
      expect
    }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({ imports: { "#value": "./value.mjs" } }),
          "value.mjs":
            "export default [import.meta.filename, import.meta.resolve('#value'), import.meta.resolve('./missing.mjs')]\n",
          "entry.cjs": `require('node:url').URL = undefined
const load = require(${JSON.stringify(loaderPath)})(module)
console.log(JSON.stringify(load('./value.mjs').default))\n`
        },
        async (directory) => {
          const filename = await realpath(path.join(directory, "value.mjs"))
          expect(
            output(
              expect,
              await runNode(
                ["--disable-warning=DEP0169", "entry.cjs"],
                esmEnv,
                {},
                { cwd: directory }
              )
            )
          ).toStrictEqual([
            filename,
            pathToFileURL(filename).href,
            pathToFileURL(path.join(directory, "missing.mjs")).href
          ])
        }
      )
    })

    it("matches native symlink identities and metadata under each preservation flag", async ({
      expect
    }) => {
      await withFiles(
        {
          "package.json": JSON.stringify({
            type: "module",
            imports: { "#linked": "./linked/value.mjs" }
          }),
          "actual/value.mjs":
            "export default [import.meta.url, import.meta.filename, import.meta.dirname, import.meta.main]\n",
          "entry.mjs":
            "console.log(JSON.stringify([(await import('#linked')).default, import.meta.resolve('#linked')]))\n",
          "actual/main.mjs":
            "console.log(JSON.stringify([import.meta.url, import.meta.filename, import.meta.dirname, import.meta.main]))\n"
        },
        async (directory) => {
          await symlink(path.join(directory, "actual"), path.join(directory, "linked"), "junction")
          for (const flags of [
            [],
            ["--preserve-symlinks"],
            ["--preserve-symlinks-main"],
            ["--preserve-symlinks", "--preserve-symlinks-main"]
          ]) {
            await compare(expect, directory, esmEnv, "entry.mjs", flags)
            await compare(expect, directory, esmEnv, "linked/main.mjs", flags)
          }
        }
      )
    }, 60_000)
  })
}
