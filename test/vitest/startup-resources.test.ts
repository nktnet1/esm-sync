import { readFile, realpath, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "vitest"
import { coverageLoader, withCompatibilityFiles } from "./helpers/coverage.ts"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

for (const esmEnv of testEnvironments) {
  describe(`startup cache resources (${esmEnv})`, () => {
    it("retains only bytecode misses and repairs while preserving mixed warm caches", async ({
      expect
    }) => {
      const loader = await realpath(coverageLoader)
      const protocol = await realpath(path.join(testPath, "test262/protocol.cjs"))
      await withCompatibilityFiles(
        {
          "first.js": "global.evaluations++; module.exports = 42",
          "second.js": "global.evaluations++; module.exports = 43",
          "extra.js": "global.evaluations++; module.exports = 44",
          "index.cjs": `const assert = require('node:assert/strict')
const path = require('node:path')
const load = require(${JSON.stringify(loader)})(module, {cjs:true, mode:'auto', cache:'./esm-cache'})
const {shared, ownRequire} = require(${JSON.stringify(protocol)}).loadOwnProtocol()
const Entry = ownRequire(shared.symbol.entry)
global.evaluations = 0
for (let run = 0; run < 2; run++) {
  assert.equal(load('./first.js'), 42)
  assert.equal(load('./second.js'), 43)
  if (process.env.USE_EXTRA === 'true') assert.equal(load('./extra.js'), 44)
}
const scripts = shared.pendingScripts.get(path.resolve('esm-cache'))
let rawSources = 0
for (const name of ['first', 'second', ...(process.env.USE_EXTRA === 'true' ? ['extra'] : [])]) {
  const entry = Entry.get(load.cache[load.resolve('./' + name + '.js')])
  if (scripts !== undefined && scripts.has(entry.cacheName)) {
    assert.equal(typeof entry.compileData.code, 'string')
    rawSources++
  } else {
    assert.equal(entry.compileData.code, null, 'retained duplicate raw CommonJS source')
  }
}
console.log(JSON.stringify({retained:scripts === undefined ? 0 : scripts.size, rawSources, evaluations:global.evaluations}))`
        },
        async (directory) => {
          const invoke = async (extra = false) => {
            const result = await runNode(
              ["index.cjs"],
              esmEnv,
              {
                USE_EXTRA: String(extra),
                ESM_OPTIONS: "{cache:'./esm-cache'}"
              },
              { cwd: directory }
            )
            expect(result.exitCode, result.stderr).toBe(0)
            return JSON.parse(result.stdout) as {
              retained: number
              rawSources: number
              evaluations: number
            }
          }
          expect(await invoke()).toStrictEqual({ retained: 2, rawSources: 2, evaluations: 2 })
          const blobPath = path.join(directory, "esm-cache/.data.blob")
          const metaPath = path.join(directory, "esm-cache/.data.json")
          const coldBlob = await readFile(blobPath)
          const coldMeta = await readFile(metaPath, "utf8")
          expect(await invoke()).toStrictEqual({ retained: 0, rawSources: 0, evaluations: 2 })
          expect(await readFile(blobPath)).toStrictEqual(coldBlob)
          expect(await readFile(metaPath, "utf8")).toBe(coldMeta)
          expect(await invoke(true)).toStrictEqual({ retained: 1, rawSources: 1, evaluations: 3 })
          expect(await invoke(true)).toStrictEqual({ retained: 0, rawSources: 0, evaluations: 3 })
          const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
            meta: Record<string, [number, number]>
          }
          expect(Object.keys(meta.meta)).toHaveLength(3)
          const [start, end] = Object.values(meta.meta)[0]!
          const blob = await readFile(blobPath)
          blob.fill(0, start, end)
          await writeFile(blobPath, blob)
          expect(await invoke(true)).toStrictEqual({ retained: 1, rawSources: 1, evaluations: 3 })
          expect(await invoke(true)).toStrictEqual({ retained: 0, rawSources: 0, evaluations: 3 })
        }
      )
    })

    it("preserves transformed CommonJS and ESM source through cache loss and warm reloads", async ({
      expect
    }) => {
      const loader = await realpath(coverageLoader)
      const protocol = await realpath(path.join(testPath, "test262/protocol.cjs"))
      await withCompatibilityFiles(
        {
          "dynamic.js": "module.exports = () => import('./value.mjs')",
          "value.mjs": "export const marker = 'source-retention-marker'",
          "index.cjs": `const assert = require('node:assert/strict')
const load = require(${JSON.stringify(loader)})(module, {cjs:true, mode:'auto', cache:'./esm-cache'})
const {shared, ownRequire} = require(${JSON.stringify(protocol)}).loadOwnProtocol()
const Entry = ownRequire(shared.symbol.entry)
const read = load('./dynamic.js')
assert.strictEqual(load('./dynamic.js'), read)
const entry = Entry.get(load.cache[load.resolve('./dynamic.js')])
assert.notEqual(entry.compileData.transforms, 0)
assert.equal(typeof entry.compileData.code, 'string')
read().then(value => {
  assert.equal(value.marker, 'source-retention-marker')
  console.log('source-retention:pass')
}).catch(error => { console.error(error); process.exitCode = 1 })`
        },
        async (directory) => {
          const invoke = async () => {
            const result = await runNode(
              ["index.cjs"],
              esmEnv,
              { ESM_OPTIONS: "{cache:'./esm-cache'}" },
              { cwd: directory }
            )
            expect(result.exitCode, result.stderr).toBe(0)
            expect(result.stdout.trim()).toBe("source-retention:pass")
          }
          await invoke()
          await invoke()
          const cache = path.join(directory, "esm-cache")
          const metadata = JSON.parse(await readFile(path.join(cache, ".data.json"), "utf8")) as {
            meta: Record<string, number[]>
          }
          const transformed = Object.entries(metadata.meta).filter(
            ([, meta]) => meta.length > 2 && meta[2] !== 0
          )
          expect(transformed.length).toBeGreaterThan(0)
          for (const [name] of transformed) await unlink(path.join(cache, name))
          await invoke()
          await invoke()
        }
      )
    })
  })
}
