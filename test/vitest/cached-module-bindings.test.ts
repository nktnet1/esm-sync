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
const forwarded = load(path.join(dir, 'forward.mjs'))
const star = load(path.join(dir, 'star.mjs'))
for (let index = 0; index < 200; index++) {
  assert.strictEqual(load(counterPath), counter)
  assert.strictEqual(load(path.join(dir, 'forward.mjs')), forwarded)
}
counter.increment()
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

    it("keeps cached import overhead approximately independent of export count", async () => {
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
const { performance } = require('node:perf_hooks')
const load = require('../esm.js')(module)
const small = ${JSON.stringify(small)}
const large = ${JSON.stringify(large)}
const measure = (filename) => {
  const namespace = load(filename)
  for (let index = 0; index < 250; index++) assert.strictEqual(load(filename), namespace)
  const samples = []
  for (let sample = 0; sample < 3; sample++) {
    const start = performance.now()
    for (let index = 0; index < 2000; index++) load(filename)
    samples.push(performance.now() - start)
  }
  return samples.sort((a, b) => a - b)[1]
}
// A generous ratio detects the former O(export count) cache hit path without
// asserting an absolute wall-clock threshold on contended CI machines.
const smallMs = measure(small)
const largeMs = measure(large)
assert.ok(largeMs < smallMs * 10, 'cached export count regression: ' + JSON.stringify({smallMs, largeMs}))
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
