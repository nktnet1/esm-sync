import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

const contexts = [
  ["timer", "setTimeout(run, 0)", false],
  ["immediate", "setImmediate(run)", false],
  ["next tick", "process.nextTick(run)", false],
  [
    "I/O callback",
    "require('node:fs').readFile('../index.js', error => {assert.ifError(error); run()})",
    false
  ],
  ["Promise reaction", "Promise.resolve().then(run)", true],
  ["microtask", "queueMicrotask(run)", true]
] as const

const fixtures = {
  "microtask.mjs": "export const value = await Promise.resolve(42)\n",
  "deferred-self.mjs": `import defer * as self from './deferred-self.mjs'
await Promise.resolve()
try {self.value} catch (error) {globalThis.__deferredError = error}
export const value = 42
export {self}
`,
  "failed-cycle-entry.mjs": "import './failed-cycle-root.mjs'\n",
  "failed-cycle-root.mjs":
    "import './failed-cycle-leaf.mjs'; await Promise.resolve(); throw globalThis.__cycleFailure\n",
  "failed-cycle-leaf.mjs":
    "import './failed-cycle-root.mjs'; globalThis.__leafRuns = (globalThis.__leafRuns || 0) + 1; await Promise.resolve(); export const value = 42\n",
  "deferred-factory.mjs":
    "export function later() {return import.defer('./failed-cycle-leaf.mjs')}\n",
  "timer.mjs": `export const value = await new Promise(resolve => setTimeout(() => resolve(42), 2))
globalThis.__continued = true
`,
  "factory.mjs": "export function later() {return import('./resources.mjs')}\n",
  "resources.mjs": `export let value = 0
await using r = {async [Symbol.asyncDispose]() {await new Promise(resolve => setTimeout(resolve, 2)); value++}}
for await (const item of [20,21]) value += item
`,
  "reentry.mjs": `export const value = await new Promise(resolve => setTimeout(() => {globalThis.__reenter(); resolve(42)}, 2))\n`,
  "cycle-leaf.mjs": "import './cycle-root.mjs'; export const value = 21\n",
  "cycle-root.mjs":
    "import './cycle-leaf.mjs'; export const value = await new Promise(resolve => setTimeout(() => {globalThis.__reenter();resolve(42)}, 2))\n",
  "pending-disposal.mjs": `await using first = {[Symbol.dispose]() {globalThis.__firstDisposed = true}}
await using pending = {[Symbol.asyncDispose]() {return new Promise(resolve => {globalThis.__resumeDisposal = resolve})}}
export const value = 42
`,
  "pending-parent.mjs": "import './pending-disposal.mjs'; globalThis.__parentContinued = true\n"
}

async function scenario(esmEnv: string, code: string, name: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-async-contexts-"))
  try {
    await Promise.all(
      Object.entries(fixtures).map(([file, source]) =>
        writeFile(path.join(directory, file), source)
      )
    )
    const result = await runNode(
      [
        "-e",
        `const assert = require('node:assert/strict')
const path = require('node:path')
const esmRequire = require('../index.js')(module)
const load = file => esmRequire(path.join(process.argv[1], file))
${code}
`,
        directory
      ],
      esmEnv,
      { ESM_OPTIONS: "{cjs:false,mode:'auto'}" },
      { cacheNamespace: `contexts-${name}` }
    )
    assert.equal(result.exitCode, 0, result.stderr || result.stdout)
    assert.equal(result.stdout.trim(), "async-context:ok")
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

for (const esmEnv of testEnvironments) {
  describe(`async execution contexts (${esmEnv})`, () => {
    it("rethrows the cycle error from a deferred namespace of a completed failed member", async () => {
      await scenario(
        esmEnv,
        `globalThis.__cycleFailure = new Error('cycle failure')
assert.throws(() => load('failed-cycle-entry.mjs'), error => error === globalThis.__cycleFailure)
const later = load('deferred-factory.mjs').later
later().then(ns => {
  assert.throws(() => ns.value, error => error === globalThis.__cycleFailure)
  return later().then(again => {
    assert.strictEqual(again, ns)
    assert.throws(() => again.value, error => error === globalThis.__cycleFailure)
    assert.equal(globalThis.__leafRuns, 1)
    console.log('async-context:ok')
  })
}).catch(error => {console.error(error); process.exitCode = 1})`,
        "deferred-failure"
      )
    })
    it("throws a coded TypeError for deferred access to an evaluating module", async () => {
      await scenario(
        esmEnv,
        `const ns = load('deferred-self.mjs')
assert.ok(globalThis.__deferredError instanceof TypeError)
assert.equal(globalThis.__deferredError.code, 'ERR_ESM_SYNC_ASYNC_REENTRANT')
assert.equal(ns.self.value, 42)
console.log('async-context:ok')`,
        "deferred-self"
      )
    })
    for (const [name, schedule, microtask] of contexts) {
      it(`guards synchronous I/O and unfinished modules in a ${name}`, async () => {
        await scenario(
          esmEnv,
          `function run() {
  if (${microtask}) assert.throws(() => load('microtask.mjs'), {code: 'ERR_ESM_SYNC_ASYNC_REENTRANT'})
  else assert.equal(load('microtask.mjs').value, 42)
  const bridge = require(path.resolve('../native', process.platform+'-'+process.arch+'-'+process.versions.modules+'.node'))
  assert.equal(bridge.canPoll(), false)
  assert.throws(() => bridge.poll(), {code: 'ERR_ESM_SYNC_ASYNC_REENTRANT'})
  let first
  for (let i = 0; i < 2; i++) assert.throws(() => load('timer.mjs'), error => {
    assert.equal(error.code, 'ERR_ESM_SYNC_ASYNC_REENTRANT')
    if (first) assert.strictEqual(error, first)
    first = error
    return true
  })
  setTimeout(() => {assert.equal(globalThis.__continued, undefined); console.log('async-context:ok')}, 20)
}
${schedule}`,
          name
        )
      })

      it(`completes asynchronous imports with iteration and disposal in a ${name}`, async () => {
        await scenario(
          esmEnv,
          `function run() {
  load('factory.mjs').later().then(ns => {
    assert.equal(ns.value, 42)
    const sync = load('resources.mjs')
    assert.equal(sync.value, 42)
    assert.strictEqual(sync, load('resources.mjs'))
    return load('factory.mjs').later().then(again => {
      assert.strictEqual(again, ns)
      console.log('async-context:ok')
    })
  }).catch(error => {console.error(error); process.exitCode = 1})
}
${schedule}`,
          `import-${name}`
        )
      })
    }

    it("rejects nested synchronous evaluation while polling without aborting the outer module", async () => {
      await scenario(
        esmEnv,
        `globalThis.__reenter = () => {
  assert.throws(() => load('reentry.mjs'), {code: 'ERR_ESM_SYNC_ASYNC_REENTRANT'})
  assert.throws(() => load('timer.mjs'), {code: 'ERR_ESM_SYNC_ASYNC_REENTRANT'})
}
assert.equal(load('reentry.mjs').value, 42)
console.log('async-context:ok')`,
        "nested"
      )
    })

    it("allows asynchronous worker imports while rejecting synchronous worker I/O re-entry", async () => {
      await scenario(
        esmEnv,
        `const {Worker} = require('node:worker_threads')
const worker = new Worker(\`
const assert = require('node:assert/strict')
const {workerData, parentPort} = require('node:worker_threads')
const load = require('../index.js')(module)
const path = require('node:path')
assert.throws(() => load(path.join(workerData, 'timer.mjs')), {code: 'ERR_ESM_SYNC_ASYNC_REENTRANT'})
load(path.join(workerData, 'factory.mjs')).later().then(ns => {assert.equal(ns.value, 42); parentPort.postMessage('ok')})
\`, {eval: true, workerData: process.argv[1]})
worker.on('error', error => {console.error(error); process.exitCode = 1})
worker.on('message', value => {assert.equal(value, 'ok'); console.log('async-context:ok')})`,
        "worker"
      )
    })

    it("keeps completed cycle members private until their async root finishes", async () => {
      await scenario(
        esmEnv,
        `globalThis.__reenter = () => {
  assert.throws(() => load('cycle-leaf.mjs'), {code: 'ERR_ESM_SYNC_ASYNC_REENTRANT'})
}
assert.equal(load('cycle-root.mjs').value, 42)
assert.equal(load('cycle-leaf.mjs').value, 21)
console.log('async-context:ok')`,
        "cycle"
      )
    })

    it("abandons pending disposal without running remaining disposers or importer bodies", async () => {
      await scenario(
        esmEnv,
        `let failure
assert.throws(() => load('pending-parent.mjs'), error => {
  assert.equal(error.code, 'ERR_ESM_SYNC_ASYNC_PENDING'); failure = error; return true
})
globalThis.__resumeDisposal()
setImmediate(() => {
  assert.equal(globalThis.__firstDisposed, undefined)
  assert.equal(globalThis.__parentContinued, undefined)
  assert.throws(() => load('pending-disposal.mjs'), error => error === failure)
  console.log('async-context:ok')
})`,
        "abandoned-disposal"
      )
    })
  })
}
