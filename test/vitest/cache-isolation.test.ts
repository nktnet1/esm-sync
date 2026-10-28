import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import JSON6 from "json-6"
import { describe, it, expect } from "vitest"
import { isolateLoaderCache, nodeEnv, runNode, testPath } from "./helpers/run-node.ts"

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
    expect((JSON6.parse(uncached.ESM_OPTIONS || "{}") as { cache?: string }).cache).toBe(
      path.join(testPath, "env/native-cache", plainEnv, "vitest-main-hook")
    )
    expect((JSON6.parse(cached.ESM_OPTIONS || "{}") as { cache?: string }).cache).toBe(
      cachePath("main-hook")
    )
    expect(uncached.ESM_OPTIONS).not.toBe(cached.ESM_OPTIONS)
    expect(options.ESM_OPTIONS).toBe("{cjs:false,mode:'auto'}")
  })

  it("keeps JSON6 option values unchanged and separates cached test files", () => {
    const options = { ESM_OPTIONS: "{cjs:0,mode:all}" }
    const main = isolateLoaderCache(options, cachedEnv, "main-hook")
    const evalHook = isolateLoaderCache(options, cachedEnv, "eval-hook")

    // mode:all is intentionally a bare legacy option, accepted by esm-sync's
    // fallback parser but not by JSON6 itself. Check the original spelling,
    // then parse only a quoted copy to verify Windows path escaping.
    for (const [namespace, isolated] of [
      ["main-hook", main],
      ["eval-hook", evalHook]
    ] as const) {
      const source = isolated.ESM_OPTIONS
      expect.assert(source)
      expect(source).toMatch(/,cjs:0,mode:all\}$/)
      const parsed = JSON6.parse(source.replace("mode:all", "mode:'all'")) as {
        cache: string
        cjs: number
        mode: string
      }
      expect(parsed.cache).toBe(cachePath(namespace))
      expect(parsed.cjs).toBe(0)
      expect(parsed.mode).toBe("all")
    }
    expect(main.ESM_OPTIONS).not.toBe(evalHook.ESM_OPTIONS)
    expect(options.ESM_OPTIONS).toBe("{cjs:0,mode:all}")
  })

  it("inserts after the opening brace without changing later braces or whitespace", () => {
    const options = {
      ESM_OPTIONS: " \n {cjs:false,mode:'auto',extra:{value:'{keep-me}'}} "
    }
    const isolated = isolateLoaderCache(options, cachedEnv, "nested-options")

    expect(isolated.ESM_OPTIONS).toMatch(/^ \n \{cache:'/)
    expect(isolated.ESM_OPTIONS).toMatch(/,cjs:false,mode:'auto',extra:\{value:'\{keep-me\}'\}\} $/)
    expect(options.ESM_OPTIONS).toBe(" \n {cjs:false,mode:'auto',extra:{value:'{keep-me}'}} ")
  })

  it("respects tests that supply their own cache setting", () => {
    const options = { ESM_OPTIONS: "{cache:false,cjs:false}" }
    expect(isolateLoaderCache(options, cachedEnv, "main-hook")).toBe(options)
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
        expect(result.exitCode, result.stderr).toBe(0)
        expect(result.stdout, result.stdout).toContain("dynamic-import-cjs:true")
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
        expect(result.exitCode, result.stderr).toBe(0)
        expect(result.stdout, result.stdout).toContain("cache:true")
      }

      for (const namespace of namespaces) {
        const cacheMeta = JSON.parse(
          await readFile(path.join(cachePath(namespace), ".data.json"), "utf8")
        ) as { meta: Record<string, unknown> }
        expect(
          Object.keys(cacheMeta.meta).length,
          "Expected a populated disk cache"
        ).toBeGreaterThan(0)
      }
    })
  })

  it.skipIf(Reflect.has(process.env, "APPVEYOR"))(
    "runs default-cache tests while unrelated consumers write the bootstrap cache",
    async () => {
      const options = { ESM_OPTIONS: "{cjs:false,mode:'auto'}" }
      const suite = runNode(
        [
          "--test-reporter=./native-test-reporter.cjs",
          "-r",
          "./native-test-bootstrap.cjs",
          "-r",
          "../index.js",
          "./native-suite.cjs",
          "cache-tests.js"
        ],
        cachedEnv,
        options,
        { cacheNamespace: "cache-suite-race", timeout: 60_000 }
      )

      // options.cache:false disables module caching, but esm.js still writes its
      // fixed package-relative bootstrap cache on exit. Those independent writers
      // must not race with the cache suite's removal/creation assertions.
      const writers = async () => {
        for (let index = 0; index < 6; index++) {
          const result = await runNode(["./fixture/cache/index.js"], cachedEnv, {
            ESM_OPTIONS: "{cache:false,cjs:false,mode:'auto'}"
          })
          expect(result.exitCode, result.stderr).toBe(0)
          expect(result.stdout, result.stdout).toContain("cache:true")
        }
      }
      const [result] = await Promise.all([suite, writers()])
      expect(result.exitCode, result.stderr || result.stdout).toBe(0)
      const summary = result.stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith("ESM_SYNC_TEST_EVENT "))
        .map((line): unknown => JSON.parse(line.slice("ESM_SYNC_TEST_EVENT ".length)))
        .find(
          (
            record
          ): record is {
            kind: "summary"
            success: boolean
            counts: { passed: number; failed: number }
          } =>
            record !== null &&
            typeof record === "object" &&
            "kind" in record &&
            record.kind === "summary"
        )
      expect.assert(summary, result.stdout)
      expect(summary.success, result.stdout).toBe(true)
      expect(summary.counts.passed, result.stdout).toBeGreaterThan(0)
      expect(summary.counts.failed, result.stdout).toBe(0)
    },
    90_000
  )
})
