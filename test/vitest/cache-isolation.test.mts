import assert from "node:assert/strict"
import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "vitest"
import { isolateLoaderCache, nodeEnv, runNode, testPath } from "./helpers/run-node.mts"

const cachedEnv = `${nodeEnv}-test-cached`
const plainEnv = `${nodeEnv}-test`
const cacheRoot = path.join(testPath, "env/native-cache", cachedEnv)

function cachePath(namespace: string) {
  return path.join(cacheRoot, `vitest-${namespace}`)
}

async function withFreshCaches(namespaces: string[], run: () => Promise<void>) {
  const clean = () =>
    Promise.all(
      namespaces.map((namespace) => rm(cachePath(namespace), { force: true, recursive: true }))
    )

  await clean()
  try {
    await run()
  } finally {
    await clean()
  }
}

describe("isolated native Node loader caches", () => {
  it("isolates both environments without mutating caller options", () => {
    const options = { ESM_OPTIONS: "{cjs:false,mode:'auto'}" }
    const uncached = isolateLoaderCache(options, plainEnv, "main-hook")
    const cached = isolateLoaderCache(options, cachedEnv, "main-hook")
    assert.ok(uncached.ESM_OPTIONS?.includes(`${plainEnv}/vitest-main-hook`))
    assert.ok(cached.ESM_OPTIONS?.includes(`${cachedEnv}/vitest-main-hook`))
    assert.notEqual(uncached.ESM_OPTIONS, cached.ESM_OPTIONS)
    assert.equal(options.ESM_OPTIONS, "{cjs:false,mode:'auto'}")
  })

  it("keeps JSON6 option values unchanged and separates cached test files", () => {
    const options = { ESM_OPTIONS: "{cjs:0,mode:all}" }
    const main = isolateLoaderCache(options, cachedEnv, "main-hook")
    const evalHook = isolateLoaderCache(options, cachedEnv, "eval-hook")

    assert.equal(main.ESM_OPTIONS, `{cache:'${cachePath("main-hook")}',cjs:0,mode:all}`)
    assert.equal(evalHook.ESM_OPTIONS, `{cache:'${cachePath("eval-hook")}',cjs:0,mode:all}`)
    assert.notEqual(main.ESM_OPTIONS, evalHook.ESM_OPTIONS)
    assert.equal(options.ESM_OPTIONS, "{cjs:0,mode:all}")
  })

  it("inserts after the opening brace without changing later braces or whitespace", () => {
    const options = {
      ESM_OPTIONS: " \n {cjs:false,mode:'auto',extra:{value:'{keep-me}'}} "
    }
    const isolated = isolateLoaderCache(options, cachedEnv, "nested-options")

    assert.ok(isolated.ESM_OPTIONS?.startsWith(" \n {cache:'"))
    assert.ok(isolated.ESM_OPTIONS?.endsWith(",cjs:false,mode:'auto',extra:{value:'{keep-me}'}} "))
    assert.equal(options.ESM_OPTIONS, " \n {cjs:false,mode:'auto',extra:{value:'{keep-me}'}} ")
  })

  it("respects tests that supply their own cache setting", () => {
    const options = { ESM_OPTIONS: "{cache:false,cjs:false}" }
    assert.equal(isolateLoaderCache(options, cachedEnv, "main-hook"), options)
  })

  it("loads .mjs imports from CommonJS concurrently with separate disk caches", async () => {
    const namespaces = ["cache-probe-a", "cache-probe-b"]
    const options = { ESM_OPTIONS: "{cjs:false,mode:'auto'}" }

    await withFreshCaches(namespaces, async () => {
      const results = await Promise.all(
        namespaces.map((cacheNamespace) =>
          runNode(
            ["-r", "../index.js", "./fixture/main-hook/dynamic-import.js"],
            cachedEnv,
            options,
            { cacheNamespace }
          )
        )
      )

      for (const result of results) {
        assert.equal(result.exitCode, 0, result.stderr)
        assert.ok(result.stdout.includes("dynamic-import-cjs:true"), result.stdout)
      }
    })
  })

  it("writes compiled-module metadata into separate disk caches concurrently", async () => {
    const namespaces = ["cache-write-a", "cache-write-b"]
    const options = { ESM_OPTIONS: "{cjs:false,mode:'auto'}" }

    await withFreshCaches(namespaces, async () => {
      // The dynamic-import fixture above can use native import without creating
      // transformed-module cache entries. The bridge fixture explicitly compiles
      // .mjs modules and is suitable for checking persisted cache metadata.
      const results = await Promise.all(
        namespaces.map((cacheNamespace) =>
          runNode(["./fixture/cache/index.js"], cachedEnv, options, { cacheNamespace })
        )
      )

      for (const result of results) {
        assert.equal(result.exitCode, 0, result.stderr)
        assert.ok(result.stdout.includes("cache:true"), result.stdout)
      }

      for (const namespace of namespaces) {
        const cacheMeta = JSON.parse(
          await readFile(path.join(cachePath(namespace), ".data.json"), "utf8")
        ) as { meta: Record<string, unknown> }
        assert.ok(Object.keys(cacheMeta.meta).length > 0, "Expected a populated disk cache")
      }
    })
  })
})
