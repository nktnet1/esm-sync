"use strict"

const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { parseArgs, styleText } = require("node:util")

const { values } = parseArgs({
  options: {
    baseline: { type: "string" },
    samples: { type: "string", default: "7" },
    iterations: { type: "string", default: "5000" },
    json: { type: "boolean", default: false },
    child: { type: "string" },
    loader: { type: "string" }
  }
})
const root = path.resolve(__dirname, "..")
const samples = Number(values.samples)
const iterations = Number(values.iterations)
assert.ok(Number.isSafeInteger(samples) && samples > 0, "samples must be a positive integer")
assert.ok(
  Number.isSafeInteger(iterations) && iterations > 0,
  "iterations must be a positive integer"
)

function measure(directory, loader) {
  const load = require(loader)(module, { cache: false, cjs: false })
  const filename = path.join(directory, values.child + ".mjs")
  const start = process.hrtime.bigint()
  let namespace
  try {
    namespace = load(filename)
  } catch (error) {
    if (error?.code?.startsWith("ERR_ESM_SYNC_ASYNC_")) return { unsupported: error.code }
    throw error
  }
  const coldMs = Number(process.hrtime.bigint() - start) / 1e6
  assert.equal(namespace.value, 42)
  const warmStart = process.hrtime.bigint()
  let last
  for (let index = 0; index < iterations; index++) last = load(filename)
  const warmUs = Number(process.hrtime.bigint() - warmStart) / iterations / 1e3
  assert.strictEqual(last, namespace)
  return { coldMs, warmUs }
}

function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "esm-sync-await-benchmark-"))
  try {
    const sources = {
      sync: "export const value = 42\n",
      "sync-graph": "export { value } from './sync.mjs'\n",
      "sync-chain": "export { value } from './sync-link-15.mjs'\n",
      microtask: "export const value = await Promise.resolve(42)\n",
      transitive: "export { value } from './microtask.mjs'\n",
      timer: "export const value = await new Promise(resolve => setTimeout(() => resolve(42), 1))\n"
    }
    for (const [name, source] of Object.entries(sources)) {
      fs.writeFileSync(path.join(directory, name + ".mjs"), source)
    }
    for (let index = 0; index < 16; index++) {
      const next = index === 0 ? "sync" : `sync-link-${index - 1}`
      fs.writeFileSync(
        path.join(directory, `sync-link-${index}.mjs`),
        `export { value } from './${next}.mjs'\n`
      )
    }
    if (values.child) {
      process.stdout.write(JSON.stringify(measure(directory, values.loader)))
      return
    }

    const median = (numbers) =>
      numbers.sort((left, right) => left - right)[Math.floor(numbers.length / 2)]
    const report = { runtime: process.version, samples, iterations, results: [] }
    const loaders = { current: root }
    if (values.baseline) loaders.baseline = path.resolve(values.baseline)

    const entries = Object.entries(loaders)
    for (const name of Object.keys(sources)) {
      const groups = new Map(entries.map(([label]) => [label, []]))
      for (let index = 0; index < samples; index++) {
        // Alternate the pair order so startup/cache/CPU drift does not always
        // favour the checkout measured second.
        for (const [label, loader] of index % 2 ? entries.slice().reverse() : entries) {
          const result = spawnSync(
            process.execPath,
            [__filename, "--child", name, "--loader", loader, "--iterations", String(iterations)],
            { encoding: "utf8", timeout: 30_000 }
          )
          if (result.status !== 0) throw result.error || new Error(result.stderr || result.stdout)
          groups.get(label).push(JSON.parse(result.stdout))
        }
      }
      for (const [label] of entries) {
        const measurements = groups.get(label)
        const unsupported = measurements.find((item) => item.unsupported)
        report.results.push(
          unsupported
            ? { loader: label, case: name, unsupported: unsupported.unsupported }
            : {
                loader: label,
                case: name,
                coldMs: median(measurements.map((item) => item.coldMs)),
                warmUs: median(measurements.map((item) => item.warmUs))
              }
        )
      }
    }
    if (values.json) console.log(JSON.stringify(report, null, 2))
    else {
      console.log(
        `${process.version}: medians of ${samples} fresh processes, ${iterations} warm requires each`
      )
      for (const result of report.results) {
        console.log(
          `${result.loader} ${styleText("cyan", result.case)}: ` +
            (result.unsupported
              ? styleText("yellow", result.unsupported)
              : `cold ${styleText("green", result.coldMs.toFixed(3))} ms; warm ${styleText("green", result.warmUs.toFixed(3))} us/load`)
        )
      }
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
