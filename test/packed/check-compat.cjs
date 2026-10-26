"use strict"

const assert = require("node:assert/strict")
const { createRequire } = require("node:module")
const path = require("node:path")
const { Worker } = require("node:worker_threads")

const importPaths = ["esm-sync", "esm-sync/esm", "esm-sync/esm.js", "esm-sync/index", "esm-sync/index.js"]

async function native() {
  // Dynamic import works from either kind of consumer, and imports of CJS
  // expose module.exports as the default export.
  const requiredCjs = require("./cjs/counter.js")
  const importedCjs = await import("./cjs/counter.js")
  assert.strictEqual(importedCjs.default, requiredCjs)
  assert.equal(importedCjs.read(), 41)

  const nativeEsm = await import("./counter.mjs")
  assert.equal(nativeEsm.counter, 41)
  assert.equal(nativeEsm.default, "packed loader")
  assert.strictEqual(nativeEsm, await import("./counter.mjs"))

  // These static imports are evaluated by the native ESM loader in both
  // consumer projects, not by esm-sync.
  const staticImports = await import("./native-interop.mjs")
  assert.equal(staticImports.esmValue, "esm-js")
  assert.strictEqual(staticImports.commonjs, requiredCjs)
  assert.strictEqual(staticImports.namedRead, requiredCjs.read)

  const fromCreateRequire = createRequire(path.join(__dirname, "native-interop.mjs"))
  assert.strictEqual(fromCreateRequire("./cjs/counter.js"), requiredCjs)

  const awaited = await import("./await-counter.mjs")
  assert.equal(awaited.counter, 41)
  // Node's synchronous require(esm) cannot evaluate top-level await. This is
  // specifically where esm-sync's synchronous loader adds functionality.
  if (process.features.require_module) {
    assert.equal(require("./counter.mjs").counter, 41)
    assert.throws(() => require("./await-counter.mjs"), { code: "ERR_REQUIRE_ASYNC_MODULE" })
  }

  // The consumer's .js default follows its own package type, not the type of
  // esm-sync or any nested fixture package.
  const projectType = require("./package.json").type
  if (projectType === "module") {
    const moduleJs = await import("./project.js")
    assert.equal(moduleJs.default.format, "module")
  } else {
    const commonjsJs = require("./project.js")
    assert.equal(commonjsJs.format, "commonjs")
    assert.strictEqual((await import("./project.js")).default, commonjsJs)
  }
  assert.equal(typeof fromCreateRequire("esm-sync"), "function")
}

async function graphs() {
  const viaCjs = require("./graph/cjs-to-esm.cjs")
  assert.equal(viaCjs.read(), 41)
  assert.equal(viaCjs.increment(), 42)
  assert.equal(viaCjs.read(), 42)

  const viaEsm = await import("./graph/esm-to-cjs-to-esm.mjs")
  assert.equal(viaEsm.read(), 42)
  assert.equal(viaEsm.increment(), 43)
  assert.equal(viaEsm.read(), 43)
}

async function boundaries(esmRequire) {
  // Nearest package.json wins over the parent project's package type.
  const commonjs = require("./boundary/cjs/file.js")
  assert.equal(commonjs.format, "cjs-js")
  assert.strictEqual((await import("./boundary/cjs/file.js")).default, commonjs)
  assert.strictEqual(esmRequire("./boundary/cjs/file.js"), commonjs)

  const moduleJs = await import("./boundary/esm/file.js")
  assert.equal(moduleJs.format, "esm-js")
  assert.equal(esmRequire("./boundary/esm/file.js").format, "esm-js")

  // Explicit extensions override even the opposing package type.
  assert.equal(require("./boundary/esm/file.cjs").format, "cjs-in-esm")
  assert.equal((await import("./boundary/cjs/file.mjs")).format, "esm-in-cjs")
  // esm-sync handles the explicit ESM .mjs entry in either package scope.
  assert.equal(esmRequire("./boundary/cjs/file.mjs").format, "esm-in-cjs")
}

async function conditions() {
  // Package self-references exercise the published import/require conditions
  // without installing a second dependency into the consumer.
  const required = require("./conditional/load-require.cjs")
  assert.equal(required.root.format, "require")
  assert.equal(required.feature.format, "require")
  assert.strictEqual(required.root, required.feature)

  const imported = await import("./conditional/load-import.mjs")
  assert.equal(imported.root.format, "import")
  assert.equal(imported.feature.format, "import")
  assert.strictEqual(imported.root, imported.feature)

}

async function exportsCheck() {
  const canonical = require("esm-sync")
  for (const specifier of importPaths) {
    assert.strictEqual(require(specifier), canonical, `require(${specifier})`)
    const namespace = await import(specifier)
    assert.strictEqual(namespace.default, canonical, `import(${specifier}).default`)
  }
  assert.match(require.resolve("esm-sync"), /[/\\]dist[/\\]esm\.js$/)
  assert.match(require.resolve("esm-sync/index"), /[/\\]dist[/\\]index\.js$/)
  assert.equal(require("esm-sync/package.json").name, "esm-sync")
  assert.throws(() => require("esm-sync/dist/esm.js"), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED"
  })
}

async function cache(esmRequire) {
  const module = esmRequire("./counter.mjs")
  assert.strictEqual(module, esmRequire("./counter.mjs"))
  assert.equal(module.counter, 41)
  assert.equal(module.increment(), 42)
  assert.equal(module.counter, 42)

  // Native ESM and esm-sync can have separate caches. Only assert identity and
  // live bindings within each loader, never equality across the two loaders.
  const native = await import("./counter.mjs")
  assert.strictEqual(native, await import("./counter.mjs"))
  assert.equal(native.counter, 41)
  assert.equal(native.increment(), 42)
  assert.equal(native.counter, 42)

  const commonjs = require("./cjs/counter.js")
  assert.strictEqual(commonjs, require("./cjs/counter.js"))
  assert.strictEqual(commonjs, (await import("./cjs/counter.js")).default)
}

function worker(filename, expected, cache) {
  return new Promise((resolve, reject) => {
    // Ordinary worker smoke tests disable the disk cache for determinism.
    // Opt-in stress rounds share one path to detect concurrent cache writes.
    const child = new Worker(path.join(__dirname, "workers", filename), {
      env: { ...process.env, ESM_OPTIONS: JSON.stringify({ cache }) }
    })
    let messageReceived = false
    let settled = false
    const timer = setTimeout(() => fail(new Error(`Worker timed out: ${filename}`)), 20000)

    function fail(error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void child.terminate().catch(() => {})
      reject(error)
    }

    child.on("message", (message) => {
      try {
        assert.deepEqual(message, { format: expected, counter: 41 })
        messageReceived = true
      } catch (error) {
        fail(error)
      }
    })
    child.once("error", fail)
    child.once("exit", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0 || !messageReceived)
        reject(new Error(`${filename} exited with ${code}; message received: ${messageReceived}`))
      else resolve()
    })
  })
}

async function workers() {
  const rounds = Number(process.env.ESM_SYNC_SMOKE_WORKER_ROUNDS ?? "1")
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 50)
    throw new Error("Invalid worker stress round count")
  const cache = rounds > 1 ? path.join(__dirname, ".worker-cache") : false
  for (let round = 0; round < rounds; round++)
    await Promise.all([
      worker("consumer.cjs", "cjs", cache),
      worker("consumer.mjs", "esm", cache)
    ])
}

const checks = { native, graphs, boundaries, conditions, exports: exportsCheck, cache, workers }

async function runCompatibilityCheck(check, esmRequire) {
  if (!Object.hasOwn(checks, check)) throw new Error(`Unknown interoperability check: ${check}`)
  await checks[check](esmRequire)
}

module.exports = { runCompatibilityCheck }
