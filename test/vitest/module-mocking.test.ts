import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"
import { coverageLoader, proxyquirePath, withCompatibilityFiles } from "./helpers/coverage.ts"

const options = { ESM_OPTIONS: "{cjs:true,mode:'auto'}" }
const chain = {
  "A.js": "import B from './B.js'; export default B\n",
  "B.js": "import C from './C.js'; export default C\n",
  "C.js": "export default 42\n"
}

for (const esmEnv of testEnvironments) {
  describe.concurrent(`module mocking and evaluation caches (${esmEnv})`, () => {
    it("preserves nested CommonJS hook failures, retries, and single evaluation", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "parent.js": "global.events.push('parent'); module.exports = require('./child.js')",
          "child.js": "global.events.push('child'); module.exports = require('./leaf.js')",
          "leaf.js": "global.events.push('leaf'); require('./failure.js'); module.exports = 42",
          "failure.js": "global.events.push('failure')",
          "later.js": "global.events.push('later'); module.exports = require('./parent.js')",
          "index.cjs": `const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const original = Module._extensions['.js']
const failure = fs.realpathSync(require.resolve('./failure.js'))
const marker = new Error('nested-hook-marker')
let fail = true
global.events = []
Module._extensions['.js'] = function(mod, filename) {
  if (fs.realpathSync(filename) === failure && fail) { fail = false; throw marker }
  return original.apply(this, arguments)
}
const load = process.env.USE_FACTORY === 'true'
  ? require(${JSON.stringify(coverageLoader)})(module, {cjs:true,mode:'auto',cache:'./esm-cache'})
  : require
try {
  assert.throws(() => load('./parent.js'), error => error === marker)
  assert.equal(load('./parent.js'), 42)
  assert.equal(load('./parent.js'), 42)
} finally { Module._extensions['.js'] = original }
setImmediate(() => {
  assert.equal(load('./later.js'), 42)
  console.log(JSON.stringify(global.events))
})`
        },
        async (directory) => {
          const native = await runNode(["index.cjs"], esmEnv, {}, { cwd: directory })
          expect(native.exitCode, native.stderr).toBe(0)
          expect(JSON.parse(native.stdout)).toStrictEqual([
            "parent",
            "child",
            "leaf",
            "parent",
            "child",
            "leaf",
            "failure",
            "later"
          ])
          for (const factory of [false, true]) {
            for (const cache of ["cold", "warm"]) {
              const result = await runNode(
                [...(factory ? [] : ["-r", coverageLoader]), "index.cjs"],
                esmEnv,
                {
                  USE_FACTORY: String(factory),
                  ESM_OPTIONS: "{cjs:true,mode:'auto',cache:'./esm-cache'}"
                },
                { cwd: directory }
              )
              expect(result.exitCode, `${factory}, ${cache}\n${result.stderr}`).toBe(0)
              expect(result.stdout).toBe(native.stdout)
            }
          }
        }
      )
    })

    it("preserves live export-star cycles in .js interop graphs", async ({ expect }) => {
      await withCompatibilityFiles(
        {
          "source.js": "export let count = 1; export function setCount(value) { count = value }\n",
          "root.js": "export * from './forward.js'; export * from './source.js'\n",
          "forward.js": "export { count } from './root.js'\n",
          "index.js": `import { count } from './root.js'
import { setCount } from './source.js'
const first = count
setCount(6)
console.log(JSON.stringify([first, count]))
`
        },
        async (directory) => {
          const native = await runNode(["index.js"], esmEnv, {}, { cwd: directory })
          expect(native.exitCode, native.stderr).toBe(0)
          expect(JSON.parse(native.stdout)).toStrictEqual([1, 6])
          for (const cjs of [false, true]) {
            const result = await runNode(
              ["-r", coverageLoader, "index.js"],
              esmEnv,
              { ESM_OPTIONS: JSON.stringify({ cjs, mode: "auto" }) },
              { cwd: directory }
            )
            expect(result.exitCode, result.stderr).toBe(0)
            expect(result.stdout, `cjs=${cjs}`).toBe(native.stdout)
          }
        }
      )
    })

    it("keeps proxyquire's local and global stubs across unused named imports", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "a.js":
            "import b from './b.js'; import { extname } from 'path'; export default () => 'a' + b + extname('')\n",
          "b.js": "",
          "c.js":
            "import a from './a.js'; import { extname } from 'path'; export default () => a()\n",
          "index.cjs": `const proxyquire = require(${JSON.stringify(proxyquirePath)})
const a = proxyquire.load('./a.js', { path: { extname: () => 'c' }, './b.js': 'b' })
const first = a.default()
const b = new String('b'); b['@global'] = true
const c = proxyquire.load('./c.js', { path: { extname: () => 'c', '@global': true }, './b.js': b })
console.log(JSON.stringify([first, c.default(), a.default()]))
`
        },
        async (directory) => {
          const result = await runNode(["-r", coverageLoader, "index.cjs"], esmEnv, options, {
            cwd: directory
          })
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stderr).toBe("")
          expect(JSON.parse(result.stdout)).toStrictEqual(["abc", "abc", "abc"])
        }
      )
    })

    it("does not retain parsed re-export modules after a dependency is replaced by a mock", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          ...chain,
          "index.cjs": `const Module = require('module')
const original = Module._load
function mock(request, value, target) {
  Module._load = function(id, parent, main) {
    if (id === request) return value
    return original.apply(this, arguments)
  }
  try { return require(target) } finally {
    Module._load = original
    for (const name of ['A.js', 'B.js', 'C.js']) delete require.cache[require.resolve('./' + name)]
  }
}
const first = mock('./B.js', 'bar', './A.js').default
const second = mock('./C.js', { __esModule: true, default: 'baz' }, './B.js').default
const repeated = mock('./C.js', { __esModule: true, default: 'again' }, './B.js').default
console.log(JSON.stringify([first, second, repeated, require('./A.js').default]))
`
        },
        async (directory) => {
          const result = await runNode(["-r", coverageLoader, "index.cjs"], esmEnv, options, {
            cwd: directory
          })
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stderr).toBe("")
          expect(JSON.parse(result.stdout)).toStrictEqual(["bar", "baz", "again", 42])
        }
      )
    })

    it("keeps Module._load probing free of cached modules and execution side effects", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          ...chain,
          "C.js": "global.probeExecutions = (global.probeExecutions || 0) + 1; export default 42\n",
          "index.cjs": `const Module = require('module')
const original = Module._load
const requests = []
Module._load = function(request) { requests.push(request); return {} }
try { require('./A.js') } finally { Module._load = original }
console.log(JSON.stringify([requests, global.probeExecutions || 0, require('./A.js').default, global.probeExecutions]))
`
        },
        async (directory) => {
          const result = await runNode(["-r", coverageLoader, "index.cjs"], esmEnv, options, {
            cwd: directory
          })
          expect(result.exitCode, result.stderr).toBe(0)
          expect(JSON.parse(result.stdout)).toStrictEqual([["./A.js"], 0, 42, 1])
        }
      )
    })

    it("does not execute a real dependency before a require hook supplies its mock", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "A.js": "import value from './B.js'; export default value\n",
          "B.js":
            "global.mockedExecutions = (global.mockedExecutions || 0) + 1; export default 'real'\n",
          "index.cjs": `const Module = require('module')
const original = Module._load
Module._load = function(request) { return request === './B.js' ? 'mock' : original.apply(this, arguments) }
let result
try { result = require('./A.js').default } finally { Module._load = original }
console.log(JSON.stringify([result, global.mockedExecutions || 0]))
`
        },
        async (directory) => {
          const result = await runNode(["-r", coverageLoader, "index.cjs"], esmEnv, options, {
            cwd: directory
          })
          expect(result.exitCode, result.stderr).toBe(0)
          expect(JSON.parse(result.stdout)).toStrictEqual(["mock", 0])
        }
      )
    })

    it("honors temporary Module._cache replacement and restoration", async ({ expect }) => {
      await withCompatibilityFiles(
        {
          "value.js":
            "global.cacheExecutions = (global.cacheExecutions || 0) + 1; export default global.cacheExecutions\n",
          "index.cjs": `const Module = require('module')
const first = require('./value.js')
const saved = Module._cache
Module._cache = Object.create(null)
let second
try { second = require('./value.js') } finally { Module._cache = saved }
console.log(JSON.stringify([first.default, second.default, require('./value.js') === first, global.cacheExecutions]))
`
        },
        async (directory) => {
          const result = await runNode(["-r", coverageLoader, "index.cjs"], esmEnv, options, {
            cwd: directory
          })
          expect(result.exitCode, result.stderr).toBe(0)
          expect(JSON.parse(result.stdout)).toStrictEqual([1, 2, true, 2])
        }
      )
    })

    it("keeps .mjs import graphs outside CommonJS Module._load interception", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "foo.mjs": "export default () => 'FOO'\n",
          "index.mjs": "import foo from './foo.mjs'; export default () => foo()\n",
          "index.js": "import foo from './foo.mjs'; export default () => foo()\n",
          "index.cjs": `const load = require(${JSON.stringify(coverageLoader)})(module, { cjs: true, mode: 'auto' })
const Module = load('module')
const original = Module._load
const requests = []
Module._load = function(request, parent, main) {
  if (request === './foo.mjs') { requests.push(request); return () => 'bar' }
  return original.apply(this, arguments)
}
try { console.log(JSON.stringify([load('./index.js').default(), load('./index.mjs').default(), requests])) }
finally { Module._load = original }
`
        },
        async (directory) => {
          const result = await runNode(["-r", coverageLoader, "index.cjs"], esmEnv, options, {
            cwd: directory
          })
          expect(result.exitCode, result.stderr).toBe(0)
          expect(JSON.parse(result.stdout)).toStrictEqual(["bar", "FOO", ["./foo.mjs"]])
        }
      )
    })

    it("keeps evaluated modules cached when persistent compilation is disabled", async ({
      expect
    }) => {
      await withCompatibilityFiles(
        {
          "config.js": "export default 'before'\n",
          "index.cjs": `const fs = require('node:fs')
const load = require(${JSON.stringify(coverageLoader)})(module, { cache: false, cjs: { cache: false }, force: true })
const first = load('./config.js')
fs.writeFileSync('./config.js', "export default 'after'\\n")
const second = load('./config.js')
console.log(JSON.stringify([first.default, second.default, first === second]))
`,
          "fresh.cjs": `const load = require(${JSON.stringify(coverageLoader)})(module, { cache: false, cjs: { cache: false }, force: true }); console.log(load('./config.js').default)\n`
        },
        async (directory) => {
          const result = await runNode(
            ["index.cjs"],
            esmEnv,
            { ESM_DISABLE_CACHE: "true" },
            { cwd: directory }
          )
          expect(result.exitCode, result.stderr).toBe(0)
          expect(JSON.parse(result.stdout)).toStrictEqual(["before", "before", true])
          const fresh = await runNode(
            ["fresh.cjs"],
            esmEnv,
            { ESM_DISABLE_CACHE: "true" },
            { cwd: directory }
          )
          expect(fresh.exitCode, fresh.stderr).toBe(0)
          expect(fresh.stdout).toBe("after\n")
        }
      )
    })
  })
}
