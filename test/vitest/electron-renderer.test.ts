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
    it("preserves an error with user-supplied invalid location data without looping", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "invalid-location.mjs":
            "export const error = globalThis.rendererError = new Error('invalid-location')\nerror.stack = globalThis.rendererFilename + ':' + '9'.repeat(400) + '\\ninvalid-location'\nthrow error"
        },
        async (directory) => {
          const result = await runNode(
            [
              "-e",
              `${setup}
const load=factory(parentFor('electron/js2c/renderer_init','.'))
globalThis.rendererFilename=path.resolve('invalid-location.mjs')
let caught
try{load('./invalid-location.mjs')}catch(error){caught=error}
assert.strictEqual(caught,globalThis.rendererError)
console.log('invalid-location:pass')`
            ],
            esmEnv,
            cacheOptions,
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stdout.trim()).toBe("invalid-location:pass")
        }
      )
    })
    it("keeps parser locations in V8's inspector data as well as the formatted stack", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "first # ü.js": "export const invalid = ;\n// source-map marker: # % ü\n",
          "syntax.js": "export function invalid() {\n  await Promise.resolve()\n}\n",
          "runtime.js":
            "export const error = globalThis.rendererError = new Error('renderer-runtime-marker')\nthrow error\n"
        },
        async (directory) => {
          const result = await runNode(
            [
              "-e",
              `${setup}
const inspector = require('node:inspector')
const {SourceMap} = require('node:module')
const {fileURLToPath} = require('node:url')
const load = factory(parentFor('electron/js2c/renderer_init','.'))
const session = new inspector.Session()
session.connect()
const scripts = new Map()
session.on('Debugger.scriptParsed', ({params}) => scripts.set(params.scriptId,params))
const post = (method,params={}) => new Promise((resolve,reject) => session.post(method,params,(error,value) => error ? reject(error) : resolve(value)))
;(async () => {
  await post('Runtime.enable')
  await post('Debugger.enable')
  const previous = new Map()
  const samples = [['first # ü.js',0,23],['syntax.js',1,null],['runtime.js',0,null]]
  for (const [file,line,column] of [...samples,...samples]) {
    let caught
    globalThis.throwRenderer = () => {
      try { load('./' + file) } catch(error) { caught = error; throw error }
    }
    const response = await post('Runtime.evaluate',{expression:'throwRenderer()'})
    const details = response.exceptionDetails
    assert.ok(details && details.stackTrace && details.exception,JSON.stringify(response))
    const frame = details.stackTrace.callFrames[0]
    const actual = frame.url.startsWith('file:') ? fileURLToPath(frame.url) : frame.url
    assert.equal(fs.realpathSync(actual),fs.realpathSync(path.resolve(file)),JSON.stringify(details))
    assert.equal(frame.lineNumber,line)
    if (file === 'runtime.js' && previous.has(file)) assert.strictEqual(caught,previous.get(file),'Cached rethrow replaced the runtime error')
    previous.set(file,caught)
    if (column !== null) assert.equal(frame.columnNumber,column)
    if (file !== 'runtime.js') {
      const script = scripts.get(frame.scriptId)
      assert.ok(script && script.sourceMapURL,JSON.stringify(script))
      const map = JSON.parse(Buffer.from(script.sourceMapURL.split(',')[1],'base64').toString())
      assert.equal(map.sourcesContent[0],fs.readFileSync(actual,'utf8'))
      const entry = new SourceMap(map).findEntry(frame.lineNumber-script.startLine,frame.columnNumber-script.startColumn)
      assert.equal(fs.realpathSync(fileURLToPath(entry.originalSource)),fs.realpathSync(actual))
      assert.equal(entry.originalLine,line)
      assert.equal(entry.originalColumn,frame.columnNumber)
    }
    assert.ok(details.exception.description.includes(caught.name),details.exception.description)
    assert.ok(caught.stack.includes(file),caught.stack)
    assert.ok(!caught.stack.includes(${JSON.stringify(loader)} + ':'),caught.stack)
    if (file === 'runtime.js') assert.strictEqual(caught,globalThis.rendererError)
  }
  delete globalThis.throwRenderer
  delete globalThis.rendererError
  session.disconnect()
  console.log('renderer-inspector:pass')
})().catch(error => { session.disconnect(); console.error(error); process.exitCode = 1 })`
            ],
            esmEnv,
            cacheOptions,
            { cwd: directory, cacheNamespace: "renderer-inspector" }
          )
          expect(result.exitCode, result.stderr || result.stdout).toBe(0)
          expect(result.stdout.trim()).toBe("renderer-inspector:pass")
        }
      )
    })

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

    it("loads the bootstrap and inline script from a separate renderer realm", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "page # ü/index.html": "<!doctype html>",
          "page # ü/renderer.js": "export const value = 'renderer-realm'",
          "renderer.js": "throw new Error('must not load the cwd decoy')"
        },
        async (directory) => {
          for (let reload = 0; reload < 2; reload++) {
            const result = await runNode(
              [
                "-e",
                `const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const vm = require('node:vm')
process.versions.electron = '8.0.0'
process.type = 'renderer'
const filename = ${JSON.stringify(loader)}
const bootstrap = new Module(filename, module)
bootstrap.filename = filename
bootstrap.paths = Module._nodeModulePaths(path.dirname(filename))
const sandbox = {
  process, Buffer, console, Module, assert, fs, path,
  module: bootstrap,
  require: Module.createRequire(filename),
  __filename: filename,
  __dirname: path.dirname(filename)
}
sandbox.global = sandbox
const context = vm.createContext(sandbox)
assert.notStrictEqual(vm.runInContext('Function', context), Function)
vm.runInContext(fs.readFileSync(filename, 'utf8'), context, {filename})
assert.equal(vm.runInContext('module.exports instanceof Function', context), true)
vm.runInContext(\`
  for (const id of ['electron/js2c/renderer_init', 'node:electron/js2c/renderer_init']) {
    const parent = new Module(id)
    parent.filename = path.resolve('page # ü/index.html')
    parent.paths = Module._nodeModulePaths(path.dirname(parent.filename))
    const before = [parent.id, parent.path, parent.filename]
    const load = module.exports(parent)
    assert.equal(fs.realpathSync(load.resolve('./renderer.js')), fs.realpathSync('page # ü/renderer.js'))
    assert.equal(load('./renderer.js').value, 'renderer-realm')
    assert.deepEqual([parent.id, parent.path, parent.filename], before)
  }
\`, context)
console.log('renderer-realm:ok')`
              ],
              esmEnv,
              cacheOptions,
              { cwd: directory, cacheNamespace: "renderer-realm" }
            )
            expect(result.exitCode, `reload=${reload}\n${result.stderr}`).toBe(0)
            expect(result.stdout.trim()).toBe("renderer-realm:ok")
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
for (const customPath of [path.resolve('custom'), 'custom']) {
for (const [id, filename] of [['application', path.resolve('page/index.html')], ['electron/js2c/renderer_init', path.resolve('page/index.html')], ['node:electron/js2c/renderer_init', path.resolve('page/index.html')], ['electron/js2c/renderer_init', null]]) {
  const parent = new Module(id)
  parent.filename = filename
  parent.path = customPath
  parent.paths = Module._nodeModulePaths(parent.path)
  const load = factory(parent)
  assert.equal(fs.realpathSync(load.resolve('./value.js')), fs.realpathSync('custom/value.js'))
  assert.equal(load('./value.js').value, 42)
}
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
