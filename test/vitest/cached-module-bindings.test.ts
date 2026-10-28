import assert from "node:assert/strict"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

async function withFixtures(run: (directory: string) => Promise<void>) {
  // Resolve the temporary root before deriving filenames: /tmp can be a
  // symlink to /private/tmp on macOS.
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-cache-hit-")))

  try {
    await Promise.all(
      Object.entries({
        "counter.mjs": `export let count = 1
export function increment() { count++ }
export async function incrementLater() { await Promise.resolve(); count++ }
export { count as default }
`,
        "reader.mjs": 'import { count } from "./counter.mjs"; export const read = () => count\n',
        "loop-state.mjs": `export let value = 0
export function assignments(read) {
  const seen = []
  for (value of (([2, 3]))) seen.push(read())
  for (value in ({ 7: null })) seen.push(read())
  for ([value] of [[9]]) { seen.push(read()) }
  for ({ x: value } of [{ x: 10 }]) seen.push(read())
  outer: for (value of [11, 12]) {
    if (value === 11) continue outer
    seen.push(read())
    break outer
  }
  for (value of [13]);
  seen.push(read())
  try {
    const failure = null
    for ([value, failure.x] of [[14, 0]]) {}
  } catch {}
  seen.push(read())
  for ([value = (value += 10)] of [[undefined]]) seen.push(read())
  return seen
}
export async function asyncAssignments(read) {
  const seen = []
  for await (value of [Promise.resolve(25), 26]) seen.push(read())
  return seen
}
export function shadowed(value) { for (value of [99]) {} return value }
export function local() { for (var value of [98]) {} return value }
export function ordinary(read) {
  value = 27
  const first = read()
  { value++ }
  const second = read()
  value += 1
  return [first, second, read()]
}
`,
        "loop-reader.mjs":
          'import { value } from "./loop-state.mjs"; export const read = () => value\n',
        "loop-cycle.mjs": `import { read } from "./loop-cycle-reader.mjs"
export var value
export const seen = []
for (var value of [31, 32]) seen.push(read())
`,
        "loop-cycle-reader.mjs":
          'import { value } from "./loop-cycle.mjs"; export const read = () => value\n',
        "forward.mjs": 'export { count, increment } from "./counter.mjs"\n',
        "star.mjs": 'export * from "./forward.mjs"\n',
        "cycle-a.mjs": `import { b } from "./cycle-b.mjs"
export function a() { return b() }
`,
        "cycle-b.mjs": `import { a } from "./cycle-a.mjs"
export function b() { return 42 }
`,
        "common.js": `let value = 1
exports.read = () => value
exports.change = (next) => { value = next }
`,
        "common-bridge.mjs": `import common from "./common.js"
export function read() { return common.read() }
`
      }).map(([filename, source]) => writeFile(path.join(directory, filename), source))
    )
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

for (const esmEnv of testEnvironments) {
  describe(`completed ESM cache hits (${esmEnv})`, () => {
    const options = { ESM_OPTIONS: "{cjs:true,mode:'auto'}" }

    it("keeps re-exports, live bindings, cycles, and CJS interoperability intact", async () => {
      await withFixtures(async (directory) => {
        const source = `
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../esm.js')(module)
const dir = ${JSON.stringify(directory)}
const counterPath = path.join(dir, 'counter.mjs')
const counter = load(counterPath)
const reader = load(path.join(dir, 'reader.mjs'))
const forwarded = load(path.join(dir, 'forward.mjs'))
const star = load(path.join(dir, 'star.mjs'))
for (let index = 0; index < 200; index++) {
  assert.strictEqual(load(counterPath), counter)
  assert.strictEqual(load(path.join(dir, 'forward.mjs')), forwarded)
}
counter.increment()
assert.equal(reader.read(), 2)
assert.equal(counter.count, 2)
assert.equal(counter.default, 2)
assert.equal(forwarded.count, 2)
assert.equal(star.count, 2)
forwarded.increment()
assert.equal(counter.count, 3)
assert.equal(star.count, 3)
const cyclic = load(path.join(dir, 'cycle-a.mjs'))
assert.equal(cyclic.a(), 42)
assert.strictEqual(load(path.join(dir, 'cycle-a.mjs')), cyclic)
const common = load(path.join(dir, 'common.js'))
const bridge = load(path.join(dir, 'common-bridge.mjs'))
assert.equal(bridge.read(), 1)
common.change(8)
assert.equal(bridge.read(), 8)
;(async () => {
  await counter.incrementLater()
  assert.equal(reader.read(), 4)
  assert.equal(counter.count, 4)
  assert.equal(counter.default, 4)
  assert.equal(forwarded.count, 4)
  assert.equal(star.count, 4)
  assert.strictEqual(load(counterPath), counter)
  console.log('cache-bindings:pass')
})().catch(error => { console.error(error); process.exitCode = 1 })
`
        const result = await runNode(["-e", source], esmEnv, options, {
          cacheNamespace: "cached-module-bindings"
        })
        assert.equal(result.exitCode, 0, (result.stderr || result.stdout).slice(-1600))
        assert.equal(result.stdout.trim(), "cache-bindings:pass")
      })
    })

    it("refreshes named imports for loop writes before the body and after partial destructuring", async () => {
      await withFixtures(async (directory) => {
        const source = `
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../esm.js')(module)
const dir = ${JSON.stringify(directory)}
const statePath = path.join(dir, 'loop-state.mjs')
const state = load(statePath)
const { read } = load(path.join(dir, 'loop-reader.mjs'))
assert.deepEqual(state.assignments(read), [2, 3, '7', 9, 10, 12, 13, 14, 24])
assert.strictEqual(load(statePath), state)
assert.equal(read(), 24)
assert.equal(state.shadowed(0), 99)
assert.equal(state.local(), 98)
assert.equal(read(), 24)
assert.deepEqual(load(path.join(dir, 'loop-cycle.mjs')).seen, [31, 32])
;(async () => {
  assert.deepEqual(await state.asyncAssignments(read), [25, 26])
  assert.strictEqual(load(statePath), state)
  assert.equal(read(), 26)
  assert.deepEqual(state.ordinary(read), [27, 28, 29])
  console.log('loop-bindings:pass')
})().catch(error => { console.error(error); process.exitCode = 1 })
`
        const result = await runNode(["-e", source], esmEnv, options, {
          cacheNamespace: "cached-loop-bindings"
        })
        assert.equal(result.exitCode, 0, (result.stderr || result.stdout).slice(-3000))
        assert.equal(result.stdout.trim(), "loop-bindings:pass")
      })
    })

    it("does not refresh completed module bindings on repeated cache hits", async () => {
      await withFixtures(async (directory) => {
        const small = path.join(directory, "small.mjs")
        const large = path.join(directory, "large.mjs")
        await Promise.all([
          writeFile(small, "export const value = 42\n"),
          writeFile(
            large,
            Array.from(
              { length: 512 },
              (_, index) => `export const value${index} = ${index}\n`
            ).join("")
          )
        ])

        const source = `
const assert = require('node:assert/strict')
const load = require('../esm.js')(module)
const { shared, ownRequire } = require('./test262/protocol.cjs').loadOwnProtocol()
const Entry = ownRequire(shared.symbol.entry)
const small = ${JSON.stringify(small)}
const large = ${JSON.stringify(large)}
const smallNamespace = load(small)
const largeNamespace = load(large)
const original = Entry.prototype.updateBindings
let refreshes = 0
Entry.prototype.updateBindings = function(...args) {
  if (this.filename === small || this.filename === large) refreshes++
  return Reflect.apply(original, this, args)
}
try {
  for (let index = 0; index < 100; index++) {
    assert.strictEqual(load(small), smallNamespace)
    assert.strictEqual(load(large), largeNamespace)
  }
  assert.equal(refreshes, 0, 'completed modules must not rescan exports on cache hits')
} finally {
  Entry.prototype.updateBindings = original
}
console.log('cache-scale:pass')
`
        const result = await runNode(["-e", source], esmEnv, options, {
          cacheNamespace: "cached-module-scale"
        })
        assert.equal(result.exitCode, 0, (result.stderr || result.stdout).slice(-1600))
        assert.equal(result.stdout.trim(), "cache-scale:pass")
      })
    })
  })
}
