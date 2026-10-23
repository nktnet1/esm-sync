import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
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
  "timer.mjs": "export const unreachable = await new Promise(resolve => setTimeout(resolve, 1))\n",
  "pending-parent.mjs":
    'import { unreachable } from "./pending.mjs"\nexport const result = unreachable\n',
  "for-await.mjs": "for await (const item of []) {}\nexport const unreachable = 1\n",
  "ordinary.mjs": "export const value = 21\n"
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
for (const name of ['pending.mjs', 'pending-parent.mjs', 'timer.mjs']) {
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
