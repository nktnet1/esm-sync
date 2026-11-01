import path from "node:path"
import { describe, it } from "vitest"
import { withCompatibilityFiles } from "./helpers/coverage.ts"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loader = path.resolve(testPath, "../esm.js")
const extension = `require = require(${JSON.stringify(loader)})(module)
module.exports = require('./main.js')`
// Match #915's compiled CommonJS entry: require an ESM-only port provider,
// then the host's virtual API. Keep the network operation asynchronous.
const main = `Object.defineProperty(exports, '__esModule', {value:true})
const port = require('port-provider')
const vscode = require('vscode')
exports.api = vscode
exports.activate = async () => vscode.register(await port.default())`
const provider = `import net from 'node:net'
export default function getPort() {
  return new Promise((resolve,reject) => {
    const server = net.createServer()
    server.on('error',reject)
    server.listen({port:0,host:'127.0.0.1'}, () => {
      const port = server.address().port
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}`

for (const esmEnv of testEnvironments) {
  const cacheOptions = { ESM_DISABLE_CACHE: esmEnv.endsWith("-cached") ? "false" : "true" }
  describe(`host-provided CommonJS modules (${esmEnv})`, () => {
    for (const order of ["before", "after"]) {
      it(`retains per-extension APIs when the native host hook is installed ${order} loader initialisation`, async ({
        expect
      }) => {
        await withCompatibilityFiles(
          {
            "first/extension.cjs": extension,
            "first/main.js": main,
            "second/extension.cjs": extension,
            "second/main.js": main,
            "node_modules/port-provider/package.json": '{"type":"module","exports":"./index.js"}',
            "node_modules/port-provider/index.js": provider,
            "facade.js": "module.exports = require('vscode')",
            "index.cjs": `const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const original = Module._load
${order === "after" ? `const factory = require(${JSON.stringify(loader)})` : ""}
const apis = new Map()
Module._load = function(request, parent, main) {
  if (request === 'vscode') {
    const filename = fs.realpathSync(parent.filename)
    if (!apis.has(filename)) apis.set(filename, {parent:filename,register(port) {return {port,filename}}})
    return apis.get(filename)
  }
  return original.apply(this, arguments)
}
${order === "before" ? `const factory = require(${JSON.stringify(loader)})` : ""}
const load = factory(module)
const direct = load('vscode')
assert.strictEqual(direct, require('vscode'))
assert.throws(() => load.resolve('vscode'), {code:'MODULE_NOT_FOUND'})
const first = require('./first/extension.cjs')
const second = require('./second/extension.cjs')
assert.notStrictEqual(first.api, second.api)
assert.equal(first.api.parent, fs.realpathSync('first/main.js'))
assert.equal(second.api.parent, fs.realpathSync('second/main.js'))
assert.equal(load('./facade.js').parent, fs.realpathSync('facade.js'))
Promise.all([first.activate(),second.activate()]).then(results => {
  for (const result of results) assert.ok(result.port > 0 && result.port <= 65535)
  assert.equal(results[0].filename, fs.realpathSync('first/main.js'))
  assert.equal(results[1].filename, fs.realpathSync('second/main.js'))
  assert.strictEqual(require('./first/extension.cjs').api, first.api)
  console.log('host-api:ok')
}).catch(error => {console.error(error); process.exitCode = 1})`
          },
          async (directory) => {
            for (let reload = 0; reload < 2; reload++) {
              // Modern Node's require(esm) would hide the legacy Electron failure.
              const result = await runNode(
                ["--no-experimental-require-module", "index.cjs"],
                esmEnv,
                cacheOptions,
                {
                  cwd: directory,
                  cacheNamespace: `host-api-${order}`
                }
              )
              expect(result.exitCode, `reload=${reload}\n${result.stderr}`).toBe(0)
              expect(result.stdout.trim()).toBe("host-api:ok")
              expect(result.stderr).toBe("")
            }
          }
        )
      })
    }

    it("does not bypass exports, retry execution errors, invent filenames, or change strict .mjs imports", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "node_modules/closed/package.json": '{"exports":"./missing.cjs"}',
          "node_modules/closed/hidden.cjs": "module.exports = 42",
          "node_modules/throws/package.json": '{"main":"index.cjs"}',
          "node_modules/throws/index.cjs": "globalThis.bodyRuns++; throw globalThis.bodyFailure",
          "body-throws.js": "globalThis.bodyRuns++; throw globalThis.bodyFailure",
          "esm-throws.js": "export {}; globalThis.bodyRuns++; throw globalThis.bodyFailure",
          "require-throws.cjs": "module.exports = require('throws')",
          "strict.mjs": "import api from 'vscode'; export default api",
          "index.cjs": `const assert = require('node:assert/strict')
const Module = require('node:module')
const original = Module._load
const hostRequests = []
const hostFailure = new Error('host hook failure')
const factory = require(${JSON.stringify(loader)})
Module._load = function(request, parent, main) {
  hostRequests.push(request)
  if (request === 'host-failure') throw hostFailure
  if (['closed','closed/hidden.cjs','vscode','./missing.cjs'].includes(request)) return {unexpected:true}
  return original.apply(this, arguments)
}
const load = factory(module)
assert.throws(() => load('closed/hidden.cjs'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'})
assert.throws(() => load('closed'), {code:'MODULE_NOT_FOUND'})
assert.throws(() => load('./missing.cjs'), {code:'MODULE_NOT_FOUND'})
assert.throws(() => load('./strict.mjs'), {code:'MODULE_NOT_FOUND'})
assert.deepEqual(hostRequests, [])
assert.throws(() => load('host-failure'), error => error === hostFailure)
assert.deepEqual(hostRequests, ['host-failure'])
hostRequests.length = 0
globalThis.bodyRuns = 0
globalThis.bodyFailure = Object.assign(new Error('body failure'), {code:'MODULE_NOT_FOUND'})
assert.throws(() => load('./require-throws.cjs'), error => error === globalThis.bodyFailure)
assert.equal(globalThis.bodyRuns, 1)
assert.deepEqual(hostRequests, [])
for (const request of ['./body-throws.js', './esm-throws.js']) {
  globalThis.bodyRuns = 0
  globalThis.bodyFailure = Object.assign(new Error('body ESM failure'), {code:'ERR_REQUIRE_ESM'})
  assert.throws(() => load(request), error => error === globalThis.bodyFailure)
  assert.equal(globalThis.bodyRuns, 1, request + ' must not execute again after throwing')
}
assert.throws(() => load('https://example.invalid/module.js'), {code:'ERR_INVALID_PROTOCOL'})
assert.deepEqual(hostRequests, [])
console.log('host-boundaries:ok')`
        },
        async (directory) => {
          const result = await runNode(
            ["--no-experimental-require-module", "index.cjs"],
            esmEnv,
            cacheOptions,
            {
              cwd: directory,
              cacheNamespace: "host-api-boundaries"
            }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stdout.trim()).toBe("host-boundaries:ok")
          expect(result.stderr).toBe("")
        }
      )
    })
  })
}
