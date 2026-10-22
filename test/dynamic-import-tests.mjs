const { describe, it } = globalThis.__esmSyncNativeTest

import Compiler from "../build/compiler.js"

import assert from "assert"
import { readFileSync } from "fs"
import createNamespace from "./create-namespace.js"
import path from "path"
import url from "url"

const isWin = process.platform === "win32"

const fileProtocol = "file://" + (isWin ? "/" : "")

const abcPath = path.resolve("fixture/export/abc.mjs")
const abcURL = fileProtocol + abcPath.replace(/\\/g, "/")
const textFixtureContents = readFileSync(path.resolve("fixture/text-module.txt"), "utf8")
const abcNs = createNamespace({
  a: "a",
  b: "b",
  c: "c",
  default: "default"
})

function assertAbcNs(ns) {
  assert.deepStrictEqual(ns, abcNs)
}

describe("dynamic import tests", () => {
  it("should reject unavailable source-phase modules without evaluating them", async () => {
    const phases = await import("./fixture/phased-dynamic-import.mjs")
    const request = "./export/abc.mjs"

    await assert.rejects(phases.source(request), (error) => error.name === "SyntaxError")
    await assert.rejects(phases.source(request, { with: {} }), (error) => error.name === "SyntaxError")
  })

  it("should defer dynamic import evaluation until export access", async () => {
    const phases = await import("./fixture/phased-dynamic-import.mjs")
    // Specifiers resolve relative to the module containing import.defer().
    const request = "./defer-unevaluated.mjs"

    globalThis.esmSyncDeferredWasEvaluated = false

    try {
      const namespace = await phases.defer(request)

      assert.strictEqual(globalThis.esmSyncDeferredWasEvaluated, false)
      assert.strictEqual(Object.getPrototypeOf(namespace), null)
      assert.strictEqual(namespace[Symbol.toStringTag], "Deferred Module")
      assert.strictEqual(globalThis.esmSyncDeferredWasEvaluated, false)
      assert.strictEqual(namespace.value, 42)
      assert.strictEqual(globalThis.esmSyncDeferredWasEvaluated, true)
    } finally {
      delete globalThis.esmSyncDeferredWasEvaluated
    }
  })

  it("should not evaluate a deferred module while it is already evaluating", async () => {
    try {
      const module = await import("./fixture/defer-self-evaluation.mjs")

      assert.ok(globalThis.esmSyncDeferredSelfError instanceof TypeError)
      assert.strictEqual(module.value, 41)
      // The failed access must not permanently prevent deferred evaluation.
      assert.strictEqual(module.getDeferredValue(), 41)
    } finally {
      delete globalThis.esmSyncDeferredSelfError
    }
  })

  it("should not evaluate a deferred module with an actively evaluating dependency", async () => {
    try {
      const root = await import("./fixture/defer-active-root.mjs")

      assert.strictEqual(root.value, 7)
      assert.ok(globalThis.esmSyncDeferredDependencyError instanceof TypeError)
      assert.strictEqual(globalThis.esmSyncDeferredDependencyLeafExecuted, undefined)

      const leaf = await import("./fixture/defer-active-leaf.mjs")
      assert.strictEqual(leaf.value, 9)
      assert.strictEqual(globalThis.esmSyncDeferredDependencyLeafExecuted, true)
    } finally {
      delete globalThis.esmSyncDeferredDependencyError
      delete globalThis.esmSyncDeferredDependencyLeafExecuted
    }
  })

  it("should preserve ToString errors for phase-qualified dynamic imports", async () => {
    const phases = await import("./fixture/phased-dynamic-import.mjs")
    const thrown = new Error("specifier conversion failed")
    const specifier = { toString() { throw thrown } }

    for (const importCall of [phases.source, phases.defer]) {
      let result

      assert.doesNotThrow(() => { result = importCall(specifier) })
      await assert.rejects(result, (error) => error === thrown)
    }
  })

  it("should validate phased import options before any loading", async () => {
    const phases = await import("./fixture/phased-dynamic-import.mjs")
    const thrown = new Error("options access failed")
    const options = { get with() { throw thrown } }

    for (const importCall of [phases.source, phases.defer]) {
      await assert.rejects(importCall("./fixture/export/abc.mjs", options), (error) => error === thrown)
    }
  })

  it("should load text modules without evaluating the contents as JavaScript", async () => {
    const ns = await import("./fixture/text-module.txt", { with: { type: "text" } })

    assert.match(textFixtureContents, /^A text module is not \{ executable JavaScript \}\.\r?\n$/)
    assert.strictEqual(ns.default, textFixtureContents)
    assert.deepStrictEqual(Object.keys(ns), ["default"])
  })

  it("should import, re-export, and forward text modules with static attributes", async () => {
    const mod = await import("./fixture/text-consumer.mjs")

    assert.strictEqual(mod.text, textFixtureContents)
    assert.strictEqual(mod.namespace.default, mod.text)
    assert.deepStrictEqual(Object.keys(mod.namespace), ["default"])
    assert.strictEqual(mod.reExported, mod.text)
    assert.strictEqual(mod.reExportedNamespace.default, mod.text)
    assert.strictEqual(mod.javascript, 17)
    assert.match(mod.rawJavaScript, /export default 17/)
  })

  it("should cache text and JavaScript modules separately for the same filename", async () => {
    const request = "./fixture/text-module.mjs"
    const first = await import(request, { with: { type: "text" } })
    const again = await import(request, { with: { type: "text" } })
    const jsModule = await import(request)

    assert.strictEqual(first, again)
    assert.match(first.default, /export default 17/)
    assert.strictEqual(jsModule.default, 17)
    assert.notStrictEqual(first, jsModule)
  })

  it("should reject a missing named export from a text module", async () => {
    await assert.rejects(import("./fixture/text-invalid-import.mjs"), SyntaxError)
  })
  it("should establish live binding of values", () =>
    import("./fixture/live.mjs").then((ns) => {
      ns.reset()
      assert.strictEqual(ns.value, 0)

      ns.add(2)
      ns.add(2)
      assert.strictEqual(ns.value, 4)

      assert.strictEqual(ns.reset(), 0)
      assert.strictEqual(ns.value, 0)
    })
  )

  it("should return false for module namespace writes in sloppy code", async () => {
    const ns = await import(abcPath)
    const assign = Function("ns", `
      const existing = (ns.a = "changed")
      const added = (ns.added = "new")
      return [existing, added]
    `)

    assert.deepStrictEqual(assign(ns), ["changed", "new"])
    assert.strictEqual(Reflect.set(ns, "a", "changed"), false)
    assert.strictEqual(Reflect.set(ns, "added", "new"), false)
    assert.strictEqual(Reflect.set(ns, Symbol("extra"), "new"), false)
    assert.strictEqual(ns.a, "a")
    assert.strictEqual(Reflect.has(ns, "added"), false)
  })

  it("should return false for module namespace deletes in sloppy code", async () => {
    const ns = await import(abcPath)
    const remove = Function("ns", "return [delete ns.a, delete ns.missing]")

    assert.deepStrictEqual(remove(ns), [false, true])
    assert.strictEqual(Reflect.deleteProperty(ns, "a"), false)
    assert.strictEqual(Reflect.deleteProperty(ns, "missing"), true)
    assert.strictEqual(Reflect.deleteProperty(ns, Symbol.toStringTag), false)
    assert.strictEqual(ns.a, "a")
  })

  it("should throw a TypeError for module namespace writes and deletes in strict code", async () => {
    const ns = await import(abcPath)
    const assignExisting = Function("ns", '"use strict"; ns.a = "changed"')
    const assignMissing = Function("ns", '"use strict"; ns.added = "new"')
    const deleteExisting = Function("ns", '"use strict"; delete ns.a')

    assert.throws(() => assignExisting(ns), TypeError)
    assert.throws(() => assignMissing(ns), TypeError)
    assert.throws(() => deleteExisting(ns), TypeError)
    assert.strictEqual(ns.a, "a")
    assert.strictEqual(Reflect.has(ns, "added"), false)
  })

  it("should accept a variable", () =>
    import(abcPath)
      .then(assertAbcNs)
  )

  it("should accept a template string", () =>
    import(`${abcPath}`)
      .then(assertAbcNs)
  )

  it("should accept an expression", () =>
    import((() => abcPath)())
      .then(assertAbcNs)
  )

  it("should support the file protocol", () =>
    import(abcURL)
      .then(assertAbcNs)
  )

  it("should coerce specifier to a string", () => {
    const { URL } = url

    let parsed

    if (URL) {
      parsed = new URL(abcURL)
    } else {
      parsed = url.parse(abcURL)
      parsed.toString = () => parsed.href
    }

    return import(parsed)
      .then(assertAbcNs)
  })

  it("should support `import()` in an initial assignment", () => {
    const p = import("./fixture/export/abc.mjs")

    return p
      .then(assertAbcNs)
  })

  it("should support `import()` in a reassignment", () => {
    let p

    p = import("./fixture/export/abc.mjs")

    return p
      .then(assertAbcNs)
  })

  it("should support `import()` in a call expression", () => {
    function identity(value) {
      return value
    }

    return identity(import("./fixture/export/abc.mjs"))
      .then(assertAbcNs)
  })

  it("should support `import()` in a catch block", () => {
    try {
      throw new Error
    } catch (_e) {
      return import("./fixture/export/abc.mjs")
        .then(assertAbcNs)
    }
  })

  it("should support `import()` in a class", () => {
    class P {
      constructor() {
        return import("./fixture/export/abc.mjs")
      }
    }

    return new P()
      .then(assertAbcNs)
  })

  it("should support `import()` in a function", () => {
    function p() {
      return import("./fixture/export/abc.mjs")
    }

    return p()
      .then(assertAbcNs)
  })

  it("should support `import()` with yield", () => {
    function* p() {
      yield import("./fixture/export/abc.mjs")
    }

    return p()
      .next()
      .value
      .then(assertAbcNs)
  })

  it("should be syntactic", () => {
    const lines = [
      "const f = import",
      "import.length",
      "import.name",
      "import.apply()",
      "import.call()",
      "import.toString()"
    ]

    for (const line of lines) {
      assert.throws(
        () => Compiler.compile(line),
        /SyntaxError/)
    }
  })

  it("should accept up to two arguments and optional trailing commas", () => {
    const lines = [
      'import("mod",)',
      'import("mod", {})',
      'import("mod", {},)',
      'import("mod", { with: { type: "json" } })'
    ]

    for (const line of lines) {
      assert.doesNotThrow(() => Compiler.compile(line), line)
    }
  })

  it("should reject invalid import options without throwing synchronously", async () => {
    for (const options of [null, false, 23, "", Symbol("options")]) {
      let promise

      assert.doesNotThrow(() => {
        promise = import(abcPath, options)
      })

      await assert.rejects(promise, TypeError)
    }

    for (const withValue of [null, false, 23, "", Symbol("attributes")]) {
      await assert.rejects(import(abcPath, { with: withValue }), TypeError)
    }

    for (const value of [undefined, null, false, 23, Symbol("value")]) {
      await assert.rejects(import(abcPath, { with: { type: value } }), TypeError)
    }
  })

  it("should reject non-coercible specifiers using the caller's TypeError", async () => {
    const symbolLike = { [Symbol.toPrimitive]() { return Symbol("specifier") } }

    for (const request of [import.meta, Symbol("specifier"), symbolLike]) {
      await assert.rejects(import(request), (error) => error.constructor === TypeError)
    }
  })

  it("should reject the original abrupt completion from import attributes", async () => {
    const thrown = new Error("import attribute access failed")

    const options = [
      { get with() { throw thrown } },
      { with: new Proxy({}, { ownKeys() { throw thrown } }) },
      { with: new Proxy({ type: "json" }, { getOwnPropertyDescriptor() { throw thrown } }) },
      { with: { get type() { throw thrown } } }
    ]

    for (const option of options) {
      let promise

      assert.doesNotThrow(() => {
        promise = import(abcPath, option)
      })

      await assert.rejects(promise, (error) => error === thrown)
    }
  })

  it("should process import attributes synchronously after coercing the specifier", async () => {
    const log = []
    const request = {
      [Symbol.toPrimitive](hint) {
        log.push(`specifier:${hint}`)
        return abcPath
      }
    }
    const withValue = new Proxy({}, {
      ownKeys() {
        log.push("keys")
        return ["hidden", Symbol("ignored")]
      },
      getOwnPropertyDescriptor(_target, key) {
        log.push(typeof key === "symbol" ? "symbol" : key)
        return { configurable: true, enumerable: false, value: "ignored" }
      },
      get() {
        throw new Error("Non-enumerable attributes must not be read")
      }
    })
    const options = {
      get with() {
        log.push("with")
        return withValue
      }
    }

    const promise = import(request, options)

    assert.deepStrictEqual(log, ["specifier:string", "with", "keys", "hidden"])
    await promise.then(assertAbcNs)
  })

  it("should accept callable options and attribute objects", async () => {
    const attributes = function attributes() {}
    const options = function options() {}
    options.with = attributes

    await import(abcPath, options).then(assertAbcNs)
  })

  it("should reject invalid argument lists", () => {
    const lines = [
      "import()",
      "import(a,b,c)",
      "import(a,b,c,)",
      "import(a,,)",
      "import(...[a])"
    ]

    for (const line of lines) {
      assert.throws(
        () => Compiler.compile(line),
        /SyntaxError/
      )
    }
  })
})
