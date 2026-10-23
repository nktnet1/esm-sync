import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.mts"

const fixtures = {
  "direct.mjs": `export let count = await Promise.resolve(40)
export function increment() { count++ }
export async function later() { return await Promise.resolve(8) }
`,
  "nested.mjs": `export const deep = await await Promise.resolve(2)
export const expression = (await Promise.resolve(3)) + 4
export class Example { [await Promise.resolve('method')]() { return 9 } }
`,
  "child.mjs": "export const value = await Promise.resolve(20)\n",
  "middle.mjs":
    'import { value } from "./child.mjs"\nexport const middle = await Promise.resolve(value + 1)\n',
  "parent.mjs": 'import { middle } from "./middle.mjs"\nexport const result = middle * 2\n',
  "handled.mjs": `export let message = ""
try { await Promise.reject("expected") } catch (error) { message = error }
export const thenable = await { then(resolve) { resolve(17) } }
`,
  "rejected.mjs":
    "await Promise.reject(globalThis.__esmSyncAwaitFailure)\nexport const unreachable = 1\n",
  "pending.mjs": "export const unreachable = await new Promise(() => {})\n",
  "timer.mjs":
    "export const value = await new Promise(resolve => setTimeout(() => resolve(42), 2))\n",
  "pending-parent.mjs":
    'import { unreachable } from "./pending.mjs"\nexport const result = unreachable\n',
  "for-await.mjs": "for await (const item of []) {}\nexport const unreachable = 1\n",
  "ordinary.mjs": "export const value = 21\n",
  "direct.js": "export const value = await Promise.resolve(42)\n",
  "io.mjs": `import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
export const file = await readFile(new URL('./ordinary.mjs', import.meta.url), 'utf8')
export let network
const server = createServer((request, response) => response.end('loopback:ok'))
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const response = await fetch('http://127.0.0.1:' + server.address().port)
  network = await response.text()
} finally { server.closeAllConnections(); server.close() }
`,
  "setup.mjs": `globalThis.__events = []
globalThis.__promise = new Promise(resolve => globalThis.__resolve = resolve)
`,
  "waiter.mjs": `globalThis.__events.push('waiter:start')
export const value = await globalThis.__promise
globalThis.__events.push('waiter:end')
`,
  "resolver.mjs": `globalThis.__events.push('resolver')
globalThis.__resolve(42)
`,
  "siblings.mjs": `import './setup.mjs'
import { value } from './waiter.mjs'
import './resolver.mjs'
globalThis.__events.push('parent')
export { value }
`,
  "shared.mjs": `globalThis.__evaluations = (globalThis.__evaluations || 0) + 1
export let count = await Promise.resolve(40)
export function increment() { count++ }
`,
  "left.mjs": `import { count } from './shared.mjs'
export { count }
export const initial = count + 1
`,
  "right.mjs": `export { count, increment } from './shared.mjs'
`,
  "diamond.mjs": `import * as left from './left.mjs'
import * as right from './right.mjs'
export { left, right }
`,
  "cycle-a.mjs": `import { value } from './cycle-b.mjs'
export function initial() { return 20 }
export const result = await Promise.resolve(value * 2)
`,
  "cycle-b.mjs": `import { initial } from './cycle-a.mjs'
export const value = await Promise.resolve(initial() + 1)
`,
  "cycle-sync-leaf.mjs": `import './cycle-root.mjs'
export const value = 21
`,
  "cycle-root.mjs": `import './cycle-sync-leaf.mjs'
await Promise.resolve()
globalThis.__cycleComplete = true
`,
  "cycle-importer.mjs": `import './cycle-sync-leaf.mjs'
if (!globalThis.__cycleComplete) throw new Error('cycle root still pending')
`,
  "cycle-entry.mjs": `import './cycle-root.mjs'
import './cycle-importer.mjs'
export const value = 42
`,
  "cycle-never-a.mjs": `import './cycle-never-b.mjs'
await new Promise(() => {})
`,
  "cycle-never-b.mjs": `import './cycle-never-a.mjs'
export const value = 21
`,
  "tdz-a.mjs": `import { value } from './tdz-b.mjs'
export const initial = 20
export const result = await Promise.resolve(value)
`,
  "tdz-b.mjs": `import { initial } from './tdz-a.mjs'
export const value = await Promise.resolve(initial)
`,
  "dynamic.mjs": `const child = await import('./timer.mjs')
export const value = child.value
`,
  "dynamic-caught.mjs": `export let caught
try { await import('./throw-value.mjs') }
catch (error) { caught = error }
export const complete = true
`,
  "dynamic-detached.mjs": `await 0
export const later = import('./timer.mjs').then(ns => ns.value)
`,
  "asi.mjs": `globalThis.__asi = 1
await 0
if (false) await Promise.reject('must not execute')
export default await Promise.resolve(42)
`,
  "destructure.mjs": `export const { x = await Promise.resolve(42) } = {}
export let y
try { throw {} } catch ({ value = await Promise.resolve(21) }) { y = value }
`,
  "never.mjs": `export let complete = false
try { await new Promise(resolve => globalThis.__resolvePending = resolve) }
catch { globalThis.__caught = true }
finally { globalThis.__finalized = true }
complete = true
globalThis.__completed = true
`,
  "late.mjs": `await new Promise(resolve => setTimeout(resolve, 50))
globalThis.__lateCompleted = true
export const value = 1
`,
  "throw-value.mjs": `globalThis.__throws = (globalThis.__throws || 0) + 1
await Promise.reject(globalThis.__failure)
`,
  "throw-parent.mjs": "import './throw-value.mjs'\nexport const unreachable = 1\n"
}

async function withFixtures(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(testPath, "fixture/async-top-level-await-"))

  try {
    await Promise.all(
      Object.entries(fixtures).map(([name, source]) =>
        writeFile(path.join(directory, name), source)
      )
    )
    await run(directory)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

for (const esmEnv of testEnvironments) {
  describe(`synchronous top-level await (${esmEnv})`, () => {
    const options = { ESM_OPTIONS: "{cjs:false,mode:'auto'}" }

    it("returns completed exports without await, preserving identity and live bindings", async () => {
      await withFixtures(async (directory) => {
        const code = `const assert = require('node:assert/strict')
const esmRequire = require('../index.js')(module)
const filename = process.argv[1]
const ns = esmRequire(filename)
assert.equal(typeof ns.then, 'undefined')
assert.equal(ns.count, 40)
assert.strictEqual(ns, esmRequire(filename))
ns.increment()
assert.equal(ns.count, 41)
ns.later().then(value => {
  assert.equal(value, 8)
  console.log('tla-direct:ok')
})
`
        const result = await runNode(
          ["-e", code, path.join(directory, "direct.mjs")],
          esmEnv,
          options,
          {
            cacheNamespace: "tla-direct"
          }
        )
        assert.equal(result.exitCode, 0, result.stderr)
        assert.equal(result.stdout.trim(), "tla-direct:ok")
      })
    })

    it("completes nested awaits, computed class keys, and transitive graphs", async () => {
      await withFixtures(async (directory) => {
        const code = `const assert = require('node:assert/strict')
const esmRequire = require('../index.js')(module)
const path = require('node:path')
const directory = process.argv[1]
const nested = esmRequire(path.join(directory, 'nested.mjs'))
assert.equal(nested.deep, 2)
assert.equal(nested.expression, 7)
assert.equal(new nested.Example().method(), 9)
assert.equal(esmRequire(path.join(directory, 'parent.mjs')).result, 42)
assert.equal(esmRequire(path.join(directory, 'ordinary.mjs')).value, 21)
console.log('tla-transitive:ok')
`
        const result = await runNode(["-e", code, directory], esmEnv, options, {
          cacheNamespace: "tla-transitive"
        })
        assert.equal(result.exitCode, 0, result.stderr)
        assert.equal(result.stdout.trim(), "tla-transitive:ok")
      })
    })

    it("resumes user catch blocks for rejections and preserves uncaught rejection identity", async () => {
      await withFixtures(async (directory) => {
        const code = `const assert = require('node:assert/strict')
const esmRequire = require('../index.js')(module)
const path = require('node:path')
const directory = process.argv[1]
const ns = esmRequire(path.join(directory, 'handled.mjs'))
assert.equal(ns.message, 'expected')
assert.equal(ns.thenable, 17)
const error = new Error('rejected')
globalThis.__esmSyncAwaitFailure = error
let first
for (let n = 0; n < 2; n++) {
  try { esmRequire(path.join(directory, 'rejected.mjs')); assert.fail('rejection missed') }
  catch (received) {
    assert.strictEqual(received, error)
    if (first) assert.strictEqual(received, first)
    first = received
  }
}
console.log('tla-rejection:ok')
`
        const result = await runNode(["-e", code, directory], esmEnv, options, {
          cacheNamespace: "tla-rejection"
        })
        assert.equal(result.exitCode, 0, result.stderr)
        assert.equal(result.stdout.trim(), "tla-rejection:ok")
      })
    })

    it("fails promptly for pending awaits, including dependencies, without exposing partial exports", async () => {
      await withFixtures(async (directory) => {
        const code = `const assert = require('node:assert/strict')
const esmRequire = require('../index.js')(module)
const path = require('node:path')
for (const name of ['pending.mjs', 'pending-parent.mjs']) {
  let previous
  for (let n = 0; n < 2; n++) {
    try { esmRequire(path.join(process.argv[1], name)); assert.fail('pending await succeeded') }
    catch (error) {
      assert.equal(error.code, 'ERR_ESM_SYNC_ASYNC_PENDING')
      if (previous) assert.strictEqual(error, previous)
      previous = error
    }
  }
}
console.log('tla-pending:ok')
`
        const result = await runNode(["-e", code, directory], esmEnv, options, {
          cacheNamespace: "tla-pending"
        })
        assert.equal(result.exitCode, 0, result.stderr)
        assert.equal(result.stdout.trim(), "tla-pending:ok")
      })
    })

    async function scenario(name: string, source: string, env: NodeJS.ProcessEnv = {}) {
      await withFixtures(async (directory) => {
        const code = `const assert = require('node:assert/strict')
const path = require('node:path')
const esmRequire = require('../index.js')(module)
const load = name => esmRequire(path.join(process.argv[1], name))
${source}
`
        const result = await runNode(
          ["-e", code, directory],
          esmEnv,
          { ...options, ...env },
          {
            cacheNamespace: `tla-${name}`
          }
        )
        assert.equal(result.exitCode, 0, result.stderr || result.stdout)
        assert.equal(result.stdout.trim(), `${name}:ok`)
      })
    }

    it("completes timers, filesystem promises, and loopback fetch without workers", async () => {
      await scenario(
        "io",
        `
assert.equal(load('timer.mjs').value, 42)
const ns = load('io.mjs')
assert.match(ns.file, /export const value = 21/)
assert.equal(ns.network, 'loopback:ok')
console.log('io:ok')
`
      )
    })

    it("starts independent siblings before waiting and evaluates shared dependencies once", async () => {
      await scenario(
        "ordering",
        `
assert.equal(load('siblings.mjs').value, 42)
assert.deepEqual(globalThis.__events, ['waiter:start', 'resolver', 'waiter:end', 'parent'])
const { left, right } = load('diamond.mjs')
assert.equal(left.initial, 41)
assert.equal(left.count, 40)
right.increment()
assert.equal(left.count, 41)
assert.equal(right.count, 41)
assert.equal(globalThis.__evaluations, 1)
console.log('ordering:ok')
`
      )
    })

    it("evaluates async cycles while preserving temporal dead zones", async () => {
      await scenario(
        "cycles",
        `
assert.equal(load('cycle-a.mjs').result, 42)
assert.equal(load('cycle-b.mjs').value, 21)
assert.equal(load('cycle-entry.mjs').value, 42)
let pending
try { load('cycle-never-a.mjs') } catch (error) { pending = error }
assert.equal(pending.code, 'ERR_ESM_SYNC_ASYNC_PENDING')
assert.throws(() => load('cycle-never-b.mjs'), error => error === pending)
let first
for (let n = 0; n < 2; n++) {
  assert.throws(() => load('tdz-a.mjs'), error => {
    assert.ok(error instanceof ReferenceError)
    if (first) assert.strictEqual(error, first)
    first = error
    return true
  })
}
console.log('cycles:ok')
`
      )
    })

    it("joins awaited dynamic imports to the graph", async () => {
      await scenario(
        "dynamic",
        `
assert.equal(load('dynamic.mjs').value, 42)
globalThis.__failure = new Error('expected')
const handled = load('dynamic-caught.mjs')
assert.strictEqual(handled.caught, globalThis.__failure)
assert.equal(handled.complete, true)
const detached = load('dynamic-detached.mjs')
assert.equal(typeof detached.later.then, 'function')
detached.later.then(value => {
  assert.equal(value, 42)
  console.log('dynamic:ok')
})
`
      )
    })

    it("caches primitive rejections in both dependencies and importers", async () => {
      for (const failure of ["undefined", "null", "0", "''"]) {
        await scenario(
          "primitive",
          `
globalThis.__failure = ${failure}
for (const file of ['throw-parent.mjs', 'throw-value.mjs', 'throw-parent.mjs']) {
  let threw = false
  try { load(file) } catch (error) {
    threw = true
    assert.strictEqual(error, globalThis.__failure)
  }
  assert.equal(threw, true)
}
assert.equal(globalThis.__throws, 1)
console.log('primitive:ok')
`
        )
      }
    })

    it("preserves statement boundaries, default exports, and binding-pattern awaits", async () => {
      await scenario(
        "syntax",
        `
assert.equal(load('asi.mjs').default, 42)
assert.equal(globalThis.__asi, 1)
const { x, y } = load('destructure.mjs')
assert.equal(x, 42)
assert.equal(y, 21)
console.log('syntax:ok')
`
      )
    })

    it("abandons failed generators without running catches, finally blocks, or later continuations", async () => {
      await scenario(
        "abandon",
        `
assert.throws(() => load('never.mjs'), { code: 'ERR_ESM_SYNC_ASYNC_PENDING' })
globalThis.__resolvePending(42)
setImmediate(() => {
  assert.equal(globalThis.__caught, undefined)
  assert.equal(globalThis.__finalized, undefined)
  assert.equal(globalThis.__completed, undefined)
  console.log('abandon:ok')
})
`
      )
    })

    it("bounds pending I/O and does not resume a timed-out module", async () => {
      await scenario(
        "deadline",
        `
let first
for (let n = 0; n < 2; n++) {
  assert.throws(() => load('late.mjs'), error => {
    assert.equal(error.code, 'ERR_ESM_SYNC_ASYNC_TIMEOUT')
    if (first) assert.strictEqual(error, first)
    first = error
    return true
  })
}
setTimeout(() => {
  assert.equal(globalThis.__lateCompleted, undefined)
  console.log('deadline:ok')
}, 80)
`,
        { ESM_SYNC_AWAIT_TIMEOUT_MS: "10" }
      )
    })

    it("rejects event-loop re-entry from callbacks and microtasks", async () => {
      await scenario(
        "reentrant",
        `
Promise.resolve().then(() => {
  assert.throws(() => load('direct.mjs'), { code: 'ERR_ESM_SYNC_ASYNC_REENTRANT' })
})
setImmediate(() => {
  assert.throws(() => load('timer.mjs'), { code: 'ERR_ESM_SYNC_ASYNC_REENTRANT' })
  console.log('reentrant:ok')
})
`
      )
    })

    it("keeps microtask-only loading available when the native bridge is absent", async () => {
      await scenario(
        "fallback",
        `
const Module = require('node:module')
const native = Module._extensions['.node']
Module._extensions['.node'] = (mod, filename) => {
  if (/[\\/]native[\\/]/.test(filename)) throw new Error('bridge absent')
  return native(mod, filename)
}
assert.equal(load('ordinary.mjs').value, 21)
assert.equal(load('direct.mjs').count, 40)
assert.throws(() => load('timer.mjs'), { code: 'ERR_ESM_SYNC_ASYNC_PENDING' })
console.log('fallback:ok')
`
      )
    })

    it("supports exported TLA even when the legacy await option is enabled", async () => {
      await scenario(
        "option",
        `
assert.equal(load('direct.js').value, 42)
console.log('option:ok')
`,
        { ESM_OPTIONS: "{cjs:false,mode:'auto',await:true}" }
      )
    })

    it("reconstructs async graph state in fresh processes with and without disk caching", async () => {
      await withFixtures(async (directory) => {
        const cacheDirectory = path.join(directory, "cache")
        const code = `const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../index.js')(module)
const file = name => path.join(process.argv[1], name)
assert.equal(load(file('parent.mjs')).result, 42)
assert.equal(load(file('cycle-a.mjs')).result, 42)
assert.equal(load(file('asi.mjs')).default, 42)
const ns = load(file('direct.mjs'))
ns.increment()
assert.strictEqual(ns, load(file('direct.mjs')))
assert.equal(ns.count, 41)
console.log('disk-cache:ok')
`
        for (const cache of [false, cacheDirectory]) {
          for (let pass = 0; pass < 2; pass++) {
            const result = await runNode(["-e", code, directory], esmEnv, {
              ESM_OPTIONS: JSON.stringify({ cache, cjs: false, mode: "auto" })
            })
            assert.equal(result.exitCode, 0, result.stderr)
            assert.equal(result.stdout.trim(), "disk-cache:ok")
            if (typeof cache === "string") {
              assert.ok((await readFile(path.join(cache, ".data.json"))).length > 0)
            }
          }
        }
      })
    })

    it("reports unsupported top-level for-await loops instead of running incomplete modules", async () => {
      await withFixtures(async (directory) => {
        const code = `const assert = require('node:assert/strict')
const esmRequire = require('../index.js')(module)
assert.throws(
  () => esmRequire(process.argv[1]),
  /Top-level for await\\.\\.\\.of is not yet supported/
)
console.log('tla-for-await:ok')
`
        const result = await runNode(
          ["-e", code, path.join(directory, "for-await.mjs")],
          esmEnv,
          options,
          { cacheNamespace: "tla-for-await" }
        )
        assert.equal(result.exitCode, 0, result.stderr)
        assert.equal(result.stdout.trim(), "tla-for-await:ok")
      })
    })
  })
}
