import path from "node:path"
import { describe, it } from "vitest"
import { withCompatibilityFiles } from "./helpers/coverage.ts"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loader = path.resolve(testPath, "../esm.js")

// Electron 8.0.0's embedded renderer_init source, supplied with #867, creates
// new Module('electron/js2c/renderer_init') and updates filename/paths only.
// These are Node regressions of that exact module shape, not browser tests.
const setup = `const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
process.versions.electron = '8.0.0'
process.type = 'renderer'
const factory = require(${JSON.stringify(loader)})
function parentFor(id, page) {
  const parent = new Module(id)
  parent.filename = path.resolve(page, 'index.html')
  parent.paths = Module._nodeModulePaths(path.dirname(parent.filename))
  return parent
}`

for (const esmEnv of testEnvironments) {
  const cacheOptions = { ESM_DISABLE_CACHE: esmEnv.endsWith("-cached") ? "false" : "true" }
  describe(`Electron renderer module bases (${esmEnv})`, () => {
    it("resolves inline scripts against their HTML page across factories and disk-cache reloads", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "renderer.js": "throw new Error('must not load the cwd decoy')",
          "first page # ü/index.html": "<!doctype html>",
          "first page # ü/renderer.js": `import {value} from 'page-dependency'
globalThis.rendererLoads = (globalThis.rendererLoads || 0) + 1
export {value}
export const url = import.meta.url`,
          "first page # ü/node_modules/page-dependency/package.json":
            '{"name":"page-dependency","main":"index.js"}',
          "first page # ü/node_modules/page-dependency/index.js": "exports.value = 'first'",
          "second/index.html": "<!doctype html>",
          "second/renderer.js": "export const value = 'second'"
        },
        async (directory) => {
          for (let reload = 0; reload < 3; reload++) {
            const result = await runNode(
              [
                "-e",
                `${setup}
for (const id of ['electron/js2c/renderer_init', 'node:electron/js2c/renderer_init']) {
  const parent = parentFor(id, 'first page # ü')
  const before = [parent.id, parent.path, parent.filename]
  const load = factory(parent)
  const expected = fs.realpathSync(path.resolve('first page # ü/renderer.js'))
  assert.equal(fs.realpathSync(load.resolve('./renderer.js')), expected)
  assert.equal(load('./renderer.js').value, 'first')
  assert.equal(fs.realpathSync(require('node:url').fileURLToPath(load('./renderer.js').url)), expected)
  assert.strictEqual(factory(parent)('./renderer.js'), load('./renderer.js'))
  assert.deepEqual([parent.id, parent.path, parent.filename], before)
  assert.equal(factory(parentFor(id, 'second'))('./renderer.js').value, 'second')
}
assert.equal(globalThis.rendererLoads, 1)
console.log('renderer:ok')`
              ],
              esmEnv,
              cacheOptions,
              { cwd: directory, cacheNamespace: "renderer-page-reload" }
            )
            expect(result.exitCode, `reload=${reload}\n${result.stderr}`).toBe(0)
            expect(result.stdout.trim()).toBe("renderer:ok")
            expect(result.stderr).toBe("")
          }
        }
      )
    })

    it("keeps application module paths and filename-less renderer modules unchanged", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "page/index.html": "<!doctype html>",
          "page/value.js": "throw new Error('must respect an application module path')",
          "custom/value.js": "export const value = 42"
        },
        async (directory) => {
          const result = await runNode(
            [
              "-e",
              `${setup}
for (const [id, filename] of [['application', path.resolve('page/index.html')], ['electron/js2c/renderer_init', path.resolve('page/index.html')], ['electron/js2c/renderer_init', null]]) {
  const parent = new Module(id)
  parent.filename = filename
  parent.path = path.resolve('custom')
  parent.paths = Module._nodeModulePaths(parent.path)
  const load = factory(parent)
  assert.equal(fs.realpathSync(load.resolve('./value.js')), fs.realpathSync('custom/value.js'))
  assert.equal(load('./value.js').value, 42)
}
console.log('renderer-paths:ok')`
            ],
            esmEnv,
            cacheOptions,
            { cwd: directory, cacheNamespace: "renderer-custom-paths" }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stdout.trim()).toBe("renderer-paths:ok")
          expect(result.stderr).toBe("")
        }
      )
    })
  })
}
