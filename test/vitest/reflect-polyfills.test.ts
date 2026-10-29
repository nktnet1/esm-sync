import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loaderPath = path.resolve(testPath, "../esm.js")
const cases = [
  {
    name: "late-properties",
    bridge: `const symbol = Symbol.for('esm-sync-reflect-polyfill')
module.exports = {
  reflect: Reflect,
  symbol,
  install() {
    Object.defineProperty(Reflect, 'metadata', {
      configurable: true, writable: true, value() { return 'metadata' }
    })
    Reflect[symbol] = 'symbol'
  },
  remove() { delete Reflect.metadata; delete Reflect[symbol] }
}
`,
    source: `const captured = Reflect
bridge.install()
assert.equal(captured.metadata(), 'metadata')
assert.equal(Reflect[bridge.symbol], 'symbol')
assert.equal(Reflect.ownKeys(captured).includes(bridge.symbol), true)
const descriptor = Object.getOwnPropertyDescriptor(captured, 'metadata')
assert.equal(descriptor.value, bridge.reflect.metadata)
assert.equal(descriptor.enumerable, false)
bridge.remove()
assert.equal('metadata' in captured, false)
assert.equal(bridge.symbol in captured, false)
assert.equal(Object.getOwnPropertyDescriptor(captured, 'metadata'), undefined)
`
  },
  {
    name: "esm-mutations",
    bridge: "module.exports = Reflect\n",
    source: `const symbol = Symbol('from-esm')
Reflect.extra = 'shared'
assert.equal(bridge.extra, 'shared')
Object.defineProperty(Reflect, symbol, { configurable: true, value: 42 })
assert.equal(bridge[symbol], 42)
assert.equal(Object.getOwnPropertyDescriptor(bridge, symbol).enumerable, false)
delete Reflect.extra
assert.equal('extra' in bridge, false)
delete Reflect[symbol]
assert.equal(symbol in bridge, false)
`
  },
  {
    name: "native-method-replacement",
    bridge: `module.exports = {
  reflect: Reflect,
  replace() { Reflect.set = () => 'replacement' },
  remove() { delete Reflect.set }
}\n`,
    source: `bridge.replace()
assert.equal(Reflect.set, bridge.reflect.set)
assert.equal(Reflect.set({}, 'x', 1), 'replacement')
assert.equal(Object.getOwnPropertyDescriptor(Reflect, 'set').value, Reflect.set)
bridge.remove()
assert.equal(Reflect.set, undefined)
assert.equal('set' in Reflect, false)
assert.equal(Object.getOwnPropertyDescriptor(Reflect, 'set'), undefined)
`
  },
  {
    name: "accessors",
    bridge: `const values = new WeakMap()
Object.defineProperty(Reflect, 'self', { configurable: true, get() { return this } })
Object.defineProperty(Reflect, 'storage', {
  configurable: true,
  get() { return values.get(this) },
  set(value) { values.set(this, value) }
})
module.exports = { reflect: Reflect }\n`,
    source: `assert.equal(Reflect.self, bridge.reflect)
assert.equal(Object.getOwnPropertyDescriptor(Reflect, 'self').get,
  Object.getOwnPropertyDescriptor(bridge.reflect, 'self').get)
Reflect.storage = 'from-esm'
assert.equal(bridge.reflect.storage, 'from-esm')
bridge.reflect.storage = 'from-cjs'
assert.equal(Reflect.storage, 'from-cjs')
const other = {}
assert.equal(Reflect.get(Reflect, 'self', other), other)
Reflect.set(Reflect, 'storage', 'explicit-receiver', other)
assert.equal(Reflect.get(Reflect, 'storage', other), 'explicit-receiver')
assert.equal(Reflect.storage, 'from-cjs')
`
  },
  {
    name: "global-replacement",
    bridge: `const original = Reflect
module.exports = {
  original,
  replacement: { metadata: 'replacement' },
  replace() { global.Reflect = this.replacement }
}\n`,
    source: `const captured = Reflect
bridge.original.metadata = 'original'
bridge.replace()
assert.equal(Reflect, bridge.replacement)
assert.equal(Reflect.metadata, 'replacement')
assert.equal(captured.metadata, 'original')
`
  },
  {
    name: "namespace-mutations",
    bridge: "module.exports = Reflect\n",
    source: `assert.deepEqual([
  Reflect.set(ns, 'value', 2),
  Reflect.set(ns, 'extra', 2),
  Reflect.defineProperty(ns, 'value', { value: 2 }),
  Reflect.defineProperty(ns, 'extra', { value: 2 }),
  Reflect.deleteProperty(ns, 'value'),
  Reflect.deleteProperty(ns, 'missing')
], [false, false, false, false, false, true])
assert.equal(ns.value, 1)
const marker = new Error('ordinary-proxy-error')
const target = new Proxy({}, {
  set() { throw marker }, defineProperty() { throw marker }, deleteProperty() { throw marker }
})
for (const operation of [
  () => Reflect.set(target, 'x', 1),
  () => Reflect.defineProperty(target, 'x', { value: 1 }),
  () => Reflect.deleteProperty(target, 'x')
]) assert.throws(operation, error => error === marker)
assert.throws(() => Reflect.set(null, 'x', 1), TypeError)
assert.throws(() => Reflect.defineProperty({}, 'x', { get: 1 }), TypeError)
`
  },
  {
    name: "cjs-freeze",
    bridge: "Object.freeze(Reflect); module.exports = Reflect\n",
    source: `assert.equal(Object.isFrozen(Reflect), true)
for (const name of ['set', 'defineProperty', 'deleteProperty']) {
  assert.equal(Reflect[name], bridge[name])
  assert.equal(Object.getOwnPropertyDescriptor(Reflect, name).value, bridge[name])
}
`
  },
  {
    name: "esm-freeze",
    bridge: "module.exports = Reflect\n",
    source: `Object.freeze(Reflect)
assert.equal(Object.isFrozen(bridge), true)
for (const name of ['set', 'defineProperty', 'deleteProperty']) {
  assert.equal(Reflect[name], bridge[name])
  assert.equal(Object.getOwnPropertyDescriptor(Reflect, name).value, bridge[name])
}
`
  },
  {
    name: "locked-writable-method",
    bridge: `Object.defineProperty(Reflect, 'set', { configurable: false })
module.exports = Reflect\n`,
    source: `const descriptor = Object.getOwnPropertyDescriptor(Reflect, 'set')
assert.equal(descriptor.configurable, false)
assert.equal(descriptor.writable, true)
assert.equal(descriptor.value, Reflect.set)
Object.defineProperty(Reflect, 'set', { writable: false })
assert.equal(Reflect.set, bridge.set)
assert.equal(Object.getOwnPropertyDescriptor(Reflect, 'set').value, bridge.set)
`
  }
] as const

async function withFiles(
  bridge: string,
  source: string,
  run: (filename: string) => Promise<void>
): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-reflect-")))
  try {
    await writeFile(path.join(directory, "bridge.js"), bridge)
    await writeFile(path.join(directory, "namespace.mjs"), "export const value = 1\n")
    const filename = path.join(directory, "index.mjs")
    await writeFile(
      filename,
      `import assert from 'node:assert/strict'
import bridge from './bridge.js'
import * as ns from './namespace.mjs'
${source}
console.log('reflect:ok')
`
    )
    await run(filename)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

for (const esmEnv of testEnvironments) {
  describe.concurrent(`Reflect polyfill interop (${esmEnv})`, () => {
    for (const { name, bridge, source } of cases) {
      it(`${name} matches native Node`, async ({ expect }) => {
        await withFiles(bridge, source, async (filename) => {
          for (const args of [[filename], ["-r", loaderPath, filename]]) {
            const result = await runNode(
              args,
              esmEnv,
              { ESM_OPTIONS: "{cjs:false,mode:'auto'}" },
              {
                cacheNamespace: "reflect-polyfills-" + name
              }
            )
            expect(result.exitCode, result.stderr.slice(-4_000)).toBe(0)
            expect(result.stderr).toBe("")
            expect(result.stdout.trim()).toBe("reflect:ok")
          }
        })
      })
    }
  })
}
