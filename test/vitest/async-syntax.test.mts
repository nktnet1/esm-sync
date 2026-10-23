import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.mts"

type Scenario = { name: string; source: string; files?: Record<string, string>; verify?: string }
const scenarios: Scenario[] = [
  {
    name: "retains distinct module identities for text and JavaScript beside deferred imports",
    files: {
      "dual.mjs":
        "globalThis.__dualRuns = (globalThis.__dualRuns || 0) + 1; export const value = await Promise.resolve(42)\n",
      "lazy.mjs": "globalThis.__lazyRan = true; export const value = 7\n"
    },
    source: `import {value} from './dual.mjs'
import text from './dual.mjs' with {type: 'text'}
import defer * as lazy from './lazy.mjs'
await Promise.resolve()
assert.equal(value, 42)
assert.match(text, /export const value/)
assert.equal(globalThis.__dualRuns, 1)
assert.equal(globalThis.__lazyRan, undefined)
assert.equal(lazy.value, 7)
assert.equal(globalThis.__lazyRan, true)
export const result = value
`
  },
  {
    name: "uses Promise intrinsics for iteration and disposal after user overrides",
    source: `const originalThen = Promise.prototype.then, originalResolve = Promise.resolve
let calls = 0
Promise.prototype.then = function(...args) {calls++; return Reflect.apply(originalThen, this, args)}
Promise.resolve = function(...args) {calls++; return Reflect.apply(originalResolve, this, args)}
try {
  for await (const value of [42]) assert.equal(value, 42)
  {await using resource = {[Symbol.asyncDispose]() {}}}
} finally {
  Promise.prototype.then = originalThen
  Promise.resolve = originalResolve
}
assert.equal(calls, 0)
export const result = 42
`
  },
  {
    name: "iterates synchronous promises and asynchronous values with the correct receivers",
    source: `let total = 0
assert.equal(await (1, Promise.resolve(42)), 42)
assert.equal(await ((Promise.resolve(42))), 42)
for await (const value of await Promise.resolve([Promise.resolve(20), 22])) total += value
assert.equal(total, 42)
let gets = 0, calls = 0
const promised = Promise.resolve(7)
const iterator = {
  get next() { gets++; return function() {
    assert.strictEqual(this, iterator)
    calls++
    return Promise.resolve(calls === 1 ? {value: promised} : {done: true})
  } }
}
for await (const value of { [Symbol.asyncIterator]() { return iterator } }) {
  assert.strictEqual(value, promised)
  Object.defineProperty(iterator, 'next', {value: () => assert.fail('next was looked up twice')})
}
assert.equal(gets, 1)
assert.equal(calls, 2)
async function native() { let sum = 0; for await (const x of [20,22]) sum += x; return sum }
assert.equal(await native(), 42)
export const result = total
`
  },
  {
    name: "preserves labels, lexical iterations, destructuring awaits, and nested cleanup",
    source: `const closures = [], events = []
async function* values(name) { try { yield []; yield [3] } finally { await Promise.resolve(); events.push(name) } }
outer: inner: for await (const [x = await Promise.resolve(2)] of values('outer')) {
  closures.push(() => x)
  { const x = 99; assert.equal(x, 99) }
  if (x === 2) continue inner
  for await (const [] of values('inner')) break outer
}
assert.deepEqual(closures.map(fn => fn()), [2,3])
assert.deepEqual(events, ['inner','outer'])
export const result = 42
`
  },
  {
    name: "keeps the lexical head in its temporal dead zone and handles empty patterns",
    source: `let x = [1], calls = 0
assert.equal(x[0], 1)
try { for await (const x of x) {} ; assert.fail('missing TDZ') } catch (error) { assert.ok(error instanceof ReferenceError) }
for await (const [] of (calls++, [[]])) {}
assert.equal(calls, 1)
for await (var [first, ...rest] of [[20,21,22]]) assert.deepEqual(rest, [21,22])
assert.equal(first, 20)
export const result = 42
`
  },
  {
    name: "awaits iterator return on break and preserves the original thrown value",
    source: `let closed = 0
const original = new Error('body'), closeError = new Error('close')
const iterable = failure => ({ [Symbol.asyncIterator]() { return {
  next() { return Promise.resolve({value: 1}) },
  async return() { assert.equal(arguments.length, 0); await new Promise(r => setTimeout(r, 2)); closed++; if (failure) throw failure; return {} }
} } })
for await (const x of iterable()) { assert.equal(x, 1); break }
assert.equal(closed, 1)
try { for await (const x of iterable(closeError)) { throw original } } catch (error) { assert.strictEqual(error, original) }
try { for await (const x of iterable(closeError)) { break } ; assert.fail() } catch (error) { assert.strictEqual(error, closeError) }
assert.equal(closed, 3)
export const result = 42
`
  },
  {
    name: "does not close for next, done, or value failures and validates iterator results",
    source: `let closed = 0
const failure = new Error('step')
for (const next of [() => {throw failure}, () => Promise.reject(failure),
  () => ({get done() {throw failure}}), () => ({get value() {throw failure}}), () => 1]) {
  try {
    for await (const x of { [Symbol.asyncIterator]() {return {next, return() {closed++; return {}}}} }) {}
    assert.fail('invalid next succeeded')
  } catch (error) { assert.ok(error === failure || error instanceof TypeError) }
}
assert.equal(closed, 0)
for (const returnValue of [1, null]) {
  try { for await (const x of { [Symbol.asyncIterator]() {return {next: () => ({}), return: () => returnValue}} }) break; assert.fail() }
  catch (error) { assert.ok(error instanceof TypeError) }
}
export const result = 42
`
  },
  {
    name: "closes synchronous iterators for rejected yielded values and awaits their return values",
    source: `const failure = new Error('yield'), events = []
function* values() { try {yield Promise.reject(failure)} finally {events.push('closed')} }
try { for await (const x of values()) {} ; assert.fail() } catch (error) {assert.strictEqual(error, failure)}
assert.deepEqual(events, ['closed'])
for await (const x of { [Symbol.iterator]() {return {
  next: () => ({value: 1}), return: () => ({value: new Promise(resolve => setTimeout(() => {events.push('return');resolve(2)}, 2)), done: true})
}} }) break
assert.deepEqual(events, ['closed','return'])
export const result = 42
`
  },
  {
    name: "preserves assignment order, imported binding errors, and exported live bindings",
    files: { "dep.mjs": "export const immutable = 7\n" },
    source: `import {immutable} from './dep.mjs'
export let assigned = 0
let closed = false
async function* values() {try {yield {assigned: 21, immutable: 9}} finally {closed = true}}
try { for await ({assigned, immutable} of values()) {} ; assert.fail() } catch (error) {assert.ok(error instanceof TypeError)}
assert.equal(assigned, 21)
assert.equal(immutable, 7)
assert.equal(closed, true)
try {for await ({immutable = await Promise.resolve(9)} of [{}]) {} ; assert.fail()} catch (error) {assert.ok(error instanceof TypeError)}
for await (assigned of [40, 42]) {}
export const result = assigned
`
  },
  {
    name: "disposes module resources before returning exports while retaining their lexical scope",
    source: `export let value = 0
await using resource = {
  disposed: false,
  async [Symbol.asyncDispose]() {await new Promise(r => setTimeout(r, 2)); this.disposed = true; value = 42}
}
export {resource}
export function read() {return value}
export const result = 42
`,
    verify: `assert.equal(ns.value, 42); assert.equal(ns.read(), 42); assert.equal(ns.resource.disposed, true)`
  },
  {
    name: "disposes mixed synchronous and asynchronous resources in reverse registration order",
    source: `const events = []
const resource = name => ({[Symbol.dispose]() {events.push(name)}})
{
  using first = resource('first')
  await using empty = null
  using second = resource('second')
  await using last = {async [Symbol.asyncDispose]() {await Promise.resolve(); events.push('last')}}
  events.push('body')
}
assert.deepEqual(events, ['body','last','second','first'])
export const result = 42
`
  },
  {
    name: "chains disposal failures without losing primitive or undefined body errors",
    source: `const body = undefined, inner = 0, outer = null
try {
  await using a = {[Symbol.asyncDispose]() {throw outer}}
  using b = {[Symbol.dispose]() {throw inner}}
  throw body
} catch (error) {
  assert.equal(error.name, 'SuppressedError')
  assert.strictEqual(error.error, outer)
  assert.strictEqual(error.suppressed.error, inner)
  assert.strictEqual(error.suppressed.suppressed, body)
  assert.equal(Object.getOwnPropertyDescriptor(error, 'error').enumerable, false)
  if (typeof SuppressedError === 'function') assert.ok(error instanceof SuppressedError)
}
export const result = 42
`
  },
  {
    name: "disposes earlier resources when acquisition fails and captures disposal methods once",
    source: `const events = [], failure = new Error('acquire')
const first = {get [Symbol.asyncDispose]() {events.push('get'); return function() {assert.strictEqual(this, first); events.push('dispose')}}}
try {
  await using a = first, b = (() => {throw failure})(), c = events.push('unreachable')
} catch (error) {assert.strictEqual(error, failure)}
assert.deepEqual(events, ['get','dispose'])
try {await using bad = {[Symbol.asyncDispose]: 3, get [Symbol.dispose]() {assert.fail('invalid async method fell back')}}; assert.fail()}
catch (error) {assert.ok(error instanceof TypeError)}
export const result = 42
`
  },
  {
    name: "ignores synchronous disposer return thenables and preserves anonymous class names",
    source: `let disposed = false, name
{
  await using fallback = {[Symbol.dispose]() {disposed = true; return {then() {assert.fail('sync disposer return was awaited')}}}}
  await using Example = class {static {name = this.name} static [Symbol.asyncDispose]() {}}
  assert.equal(Example.name, 'Example')
}
assert.equal(name, 'Example')
assert.equal(disposed, true)
export const result = 42
`
  },
  {
    name: "disposes for-of resources on continue and before closing an async iterator",
    source: `const events = []
const resources = [1,2].map(x => ({x, async [Symbol.asyncDispose]() {await Promise.resolve(); events.push('dispose:'+x)}}))
loop: for (await using x of resources) {events.push('body:'+x.x); continue loop}
async function* values() {try {yield* resources} finally {events.push('close')}}
for await (await using x of values()) {events.push('async:'+x.x); break}
for await (using x of [{[Symbol.dispose]() {events.push('sync')}}]) {}
assert.deepEqual(events, ['body:1','dispose:1','body:2','dispose:2','async:1','dispose:1','close','sync'])
export const result = 42
`
  },
  {
    name: "supports synchronous using scopes without classifying them as asynchronous",
    source: `let count = 0
{using a = {[Symbol.dispose]() {count++}}}
assert.equal(count, 1)
export const result = 42
`
  },
  {
    name: "disposes switch and classic for scopes across fallthrough and labeled exits",
    source: `const events = []
const resource = name => ({[Symbol.asyncDispose]() {events.push(name)}})
outer: switch (1) {
  case 1:
    await using first = resource('first')
    events.push('case:1')
  case 2:
    await using second = resource('second')
    break outer
  default: assert.fail('unreachable')
}
let count = 0
loop: for (await using once = resource('once'); count < 2; count++) {
  events.push('body:'+count)
  if (count === 0) continue loop
  break loop
}
assert.deepEqual(events, ['case:1','second','first','body:0','body:1','once'])
export const result = 42
`
  },
  {
    name: "retains cyclic hoisted functions and imported temporal checks with module disposal",
    files: { "cycle.mjs": "import {hoisted} from './main.mjs'; export const value = hoisted()\n" },
    source: `import {value} from './cycle.mjs'
export function hoisted() {return 21}
await using r = null
for await (const x of [value]) {assert.equal(x, 21)}
export const result = value * 2
`
  },
  {
    name: "registers awaited resource initializers and preserves const bindings",
    source: `let disposed = 0
{await using resource = (0, await Promise.resolve({[Symbol.asyncDispose]() {disposed++}}))
  assert.ok(resource)
  assert.throws(() => {resource = null}, TypeError)
}
assert.equal(disposed, 1)
export const result = 42
`
  },
  {
    name: "suspends for null asynchronous resources before disposing synchronous ones",
    source: `const events = []
{using first = {[Symbol.dispose]() {events.push('dispose')}}
  await using empty = undefined
  Promise.resolve().then(() => events.push('microtask'))
  events.push('body')
}
assert.deepEqual(events, ['body','microtask','dispose'])
export const result = 42
`
  },
  {
    name: "caches disposal rejection in the module and its static importers",
    files: { "parent.mjs": "import './main.mjs'; export const result = 42\n" },
    source: `globalThis.__disposals = (globalThis.__disposals || 0) + 1
await using r = {[Symbol.asyncDispose]() {return Promise.reject(globalThis.__disposalError)}}
export const result = 42
`,
    verify: `globalThis.__disposalError = new Error('dispose')
for (const file of ['parent.mjs','main.mjs','parent.mjs']) assert.throws(() => load(file), error => error === globalThis.__disposalError)
assert.equal(globalThis.__disposals, 1)`
  }
]

for (const esmEnv of testEnvironments) {
  describe(`async syntax (${esmEnv})`, () => {
    for (const [index, scenario] of scenarios.entries()) {
      it(scenario.name, async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-async-syntax-"))
        try {
          const files = {
            ...scenario.files,
            "main.mjs": `import assert from 'node:assert/strict'\n${scenario.source}`
          }
          await Promise.all(
            Object.entries(files).map(([name, source]) =>
              writeFile(path.join(directory, name), source)
            )
          )
          const code = `const assert = require('node:assert/strict')
const path = require('node:path')
const esmRequire = require('../index.js')(module)
const load = name => esmRequire(path.join(process.argv[1], name))
${scenario.name.startsWith("caches disposal") ? scenario.verify : `const ns = load('main.mjs'); assert.equal(ns.result, 42); assert.strictEqual(ns, load('main.mjs')); ${scenario.verify || ""}`}
console.log('async-syntax:ok')
`
          // Include two fresh processes against a populated disk cache. Moved
          // bindings and resource scopes must survive serialization as well.
          const cache = esmEnv.endsWith("-cached") ? path.join(directory, "cache") : false
          for (let pass = 0; pass < (cache ? 2 : 1); pass++) {
            const result = await runNode(
              ["-e", code, directory],
              esmEnv,
              {
                ESM_OPTIONS: JSON.stringify({ cjs: false, mode: "auto", cache })
              },
              { cacheNamespace: `async-syntax-${index}` }
            )
            assert.equal(result.exitCode, 0, result.stderr || result.stdout)
            assert.equal(result.stdout.trim(), "async-syntax:ok")
            if (cache) assert.ok((await readFile(path.join(cache, ".data.json"))).length > 0)
          }
        } finally {
          await rm(directory, { force: true, recursive: true })
        }
      })
    }
  })
}
