import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs"
import http from "node:http"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { parseArgs, styleText } from "node:util"

const root = path.resolve(path.dirname(realpathSync(process.argv[1]!)), "../..")
const { values } = parseArgs({
  options: {
    project: { type: "string" },
    baseline: { type: "string" },
    loader: { type: "string", default: path.join(root, "dist/esm.js") },
    node: { type: "string", default: process.execPath },
    iterations: { type: "string", default: "10" },
    workload: { type: "string", default: "version" },
    "profile-dir": { type: "string" },
    json: { type: "boolean", default: false }
  }
})
const project = realpathSync(path.resolve(values.project ?? "."))
const entry = realpathSync(path.join(project, "packages/global-cli/dist/index.js"))
const iterations = Number(values.iterations)
assert.ok(
  Number.isSafeInteger(iterations) && iterations >= 1 && iterations <= 100,
  "iterations must be between 1 and 100"
)
assert.ok(
  values.workload === "version" || values.workload === "preview",
  "workload must be version or preview"
)
const workload = values.workload
const executable = realpathSync(values.node)
const node = spawnSync(executable, ["--version"], { encoding: "utf8" })
assert.equal(node.status, 0, node.stderr)
const baseline = values.baseline ?? createRequire(entry).resolve("esm")
const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-sync-log4brains-")))
const profileDirectory =
  values["profile-dir"] === undefined ? undefined : path.resolve(values["profile-dir"])
if (profileDirectory !== undefined) mkdirSync(profileDirectory, { recursive: true })

// Both loaders are invoked by the unchanged historical CLI's require('esm').
// Preserve the factory's options except for its private compiler-cache path.
// ESM_OPTIONS alone does not override an explicit factory configuration.
const wrapper = path.join(directory, "run.cjs")
writeFileSync(
  wrapper,
  `
process.on('exit', () => { if (process.connected) process.send({usage:process.resourceUsage()}) })
const Module = require('node:module')
const http = require('node:http')
const load = Module._load
Module._load = function(request, parent, isMain) {
  if (request !== 'esm') return Reflect.apply(load, this, [request, parent, isMain])
  const factory = Reflect.apply(load, this, [process.env.BENCH_LOADER, parent, isMain])
  return (mod, options) => factory(mod, {...options, cache:process.env.BENCH_CACHE})
}
if (process.env.BENCH_WORKLOAD === 'preview') {
  const listen = http.Server.prototype.listen
  http.Server.prototype.listen = function(...args) {
    this.once('listening', () => process.send({port:this.address().port}))
    return Reflect.apply(listen, this, args)
  }
  process.on('message', message => { if (message === 'stop') process.exit(0) })
  process.channel.unref()
}
process.argv = [process.execPath, process.env.BENCH_ENTRY, ...(process.env.BENCH_WORKLOAD === 'version'
  ? ['--version'] : ['preview','--no-open','--port','0'])]
require(process.env.BENCH_ENTRY)
`
)

function hash(filename: string): string {
  return createHash("sha256").update(readFileSync(filename)).digest("hex")
}

function stage(filename: string, name: string) {
  filename = realpathSync(filename)
  const sourceDirectory = path.dirname(filename)
  const runtime = path.join(sourceDirectory, "esm/loader.js")
  assert.ok(
    existsSync(runtime),
    `Expected an esm bootstrap with sibling esm/loader.js: ${filename}`
  )
  const inDist = path.basename(sourceDirectory) === "dist"
  const packageDirectory = inDist ? path.dirname(sourceDirectory) : sourceDirectory
  const target = path.join(directory, name)
  const output = inDist ? path.join(target, "dist") : target
  mkdirSync(output, { recursive: true })
  cpSync(path.join(packageDirectory, "package.json"), path.join(target, "package.json"))
  cpSync(filename, path.join(output, path.basename(filename)))
  mkdirSync(path.join(output, "esm"))
  cpSync(runtime, path.join(output, "esm/loader.js"))
  const cache = path.join(target, "compiler-cache")
  return {
    loader: path.join(output, path.basename(filename)),
    cache,
    bootstrapCache: path.join(target, "node_modules/.cache/esm"),
    source: filename,
    bootstrapSHA256: hash(filename),
    runtimeSHA256: hash(runtime)
  }
}

type Staged = ReturnType<typeof stage>
interface Sample {
  iteration: number
  cache: "cold" | "warm"
  loader: "baseline" | "fork"
  elapsedMs: number
  cpuUserMs: number
  cpuSystemMs: number
  maxRSS: number
  loadAverage: number[]
  bootstrapCached: boolean
  compilerCached: boolean
  output: string
}

function run(
  staged: Staged,
  loader: Sample["loader"],
  cache: Sample["cache"],
  iteration: number
): Promise<Sample> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    for (const key of [
      "NODE_OPTIONS",
      "NODE_COMPILE_CACHE",
      "ESM_DISABLE_CACHE",
      "ESM_ENV",
      "DEBUG",
      "BABEL_ENV"
    ])
      delete env[key]
    Object.assign(env, {
      NODE_ENV: "production",
      NODE_USE_ENV_PROXY: "0",
      NEXT_TELEMETRY_DISABLED: "1",
      NO_COLOR: "1",
      ESM_OPTIONS: JSON.stringify({ cache: staged.cache }),
      BENCH_LOADER: staged.loader,
      BENCH_CACHE: staged.cache,
      BENCH_ENTRY: entry,
      BENCH_WORKLOAD: workload
    })
    const profile =
      profileDirectory === undefined
        ? []
        : [
            "--cpu-prof",
            `--cpu-prof-dir=${profileDirectory}`,
            `--cpu-prof-name=${loader}-${iteration}-${cache}.cpuprofile`
          ]
    const loadAverage = os.loadavg()
    const bootstrapCached = existsSync(path.join(staged.bootstrapCache, ".data.json"))
    const compilerCached = existsSync(path.join(staged.cache, ".data.json"))
    assert.equal(bootstrapCached, cache === "warm", "Unexpected bootstrap-cache state")
    assert.equal(compilerCached, cache === "warm", "Unexpected compiler-cache state")
    const started = performance.now()
    const child = spawn(executable, [...profile, wrapper], {
      cwd: project,
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    })
    let stdout = ""
    let stderr = ""
    let elapsedMs: number | undefined
    let output: string | undefined
    let failure: Error | undefined
    let probing = false
    let usage = { userCPUTime: 0, systemCPUTime: 0, maxRSS: 0 }
    const timeout = setTimeout(() => {
      failure = new Error(`Timed out: ${loader} ${cache}\n${stderr}`)
      child.kill("SIGKILL")
    }, 60_000)
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk
    })
    child.once("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on("message", (message: unknown) => {
      if (typeof message !== "object" || message === null) return
      const record = message as Record<string, unknown>
      if (record.usage !== undefined) usage = record.usage as typeof usage
      if (probing || typeof record.port !== "number" || workload !== "preview") return
      probing = true
      const request = http.get({ host: "127.0.0.1", port: record.port, path: "/" }, (response) => {
        let body = ""
        response.setEncoding("utf8").on("data", (chunk: string) => {
          body += chunk
        })
        response.on("end", () => {
          elapsedMs = performance.now() - started
          if (response.statusCode !== 200 || !body.includes("Log4brains")) {
            failure = new Error(
              `Invalid preview response: ${response.statusCode}\n${body.slice(0, 1000)}`
            )
          }
          output = hashText(body)
          // Normal process exit flushes both loaders' compiler caches and CPU profiles.
          if (child.connected) child.send("stop")
        })
        response.on("error", (error) => {
          failure = error
          child.kill("SIGKILL")
        })
      })
      request.setTimeout(30_000, () => request.destroy(new Error("HTTP readiness timed out")))
      request.on("error", (error) => {
        failure = error
        child.kill("SIGKILL")
      })
    })
    child.once("close", (code, signal) => {
      clearTimeout(timeout)
      if (failure || code !== 0 || signal !== null) {
        reject(failure ?? new Error(`${loader} ${cache} failed (${code}, ${signal}):\n${stderr}`))
        return
      }
      if (workload === "version") {
        elapsedMs = performance.now() - started
        output = stdout.trim()
        if (!/^\d+\.\d+\.\d+/.test(output)) {
          reject(new Error(`Invalid CLI version: ${output}`))
          return
        }
      }
      if (elapsedMs === undefined || output === undefined) {
        reject(new Error("Child exited before HTTP readiness"))
        return
      }
      resolve({
        iteration,
        cache,
        loader,
        elapsedMs,
        cpuUserMs: usage.userCPUTime / 1000,
        cpuSystemMs: usage.systemCPUTime / 1000,
        maxRSS: usage.maxRSS,
        loadAverage,
        bootstrapCached,
        compilerCached,
        output
      })
    })
  })
}

function hashText(source: string): string {
  return createHash("sha256").update(source).digest("hex")
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

async function main() {
  try {
    const loaders = { baseline: stage(baseline, "baseline"), fork: stage(values.loader, "fork") }
    const samples: Sample[] = []
    let expectedOutput: string | undefined
    for (let iteration = 0; iteration < iterations; iteration++) {
      for (const staged of Object.values(loaders)) {
        rmSync(staged.cache, { recursive: true, force: true })
        rmSync(staged.bootstrapCache, { recursive: true, force: true })
      }
      const order =
        iteration % 2 === 0 ? (["baseline", "fork"] as const) : (["fork", "baseline"] as const)
      // Cold and warm are separate paired blocks. Both caches are private to a
      // loader; the warm run reuses exactly its preceding cold run's cache.
      for (const cache of ["cold", "warm"] as const) {
        for (const loader of order) {
          const sample = await run(loaders[loader], loader, cache, iteration)
          expectedOutput ??= sample.output
          assert.equal(
            sample.output,
            expectedOutput,
            "Application responses differ; timings are not equivalent"
          )
          assert.ok(
            existsSync(path.join(loaders[loader].cache, ".data.json")),
            `${loader} did not create its compiler cache`
          )
          assert.ok(
            existsSync(path.join(loaders[loader].bootstrapCache, ".data.json")),
            `${loader} did not create its bootstrap cache`
          )
          samples.push(sample)
          if (!values.json)
            console.log(`${loader} ${cache} ${iteration + 1}: ${sample.elapsedMs.toFixed(1)} ms`)
        }
      }
    }
    const summary = Object.fromEntries(
      Object.keys(loaders).map((loader) => [
        loader,
        Object.fromEntries(
          ["cold", "warm"].map((cache) => {
            const times = samples
              .filter((sample) => sample.loader === loader && sample.cache === cache)
              .map((sample) => sample.elapsedMs)
            return [
              cache,
              { medianMs: median(times), minMs: Math.min(...times), maxMs: Math.max(...times) }
            ]
          })
        )
      ])
    )
    const paired = Object.fromEntries(
      ["cold", "warm"].map((cache) => {
        const ratios = Array.from({ length: iterations }, (_, iteration) => {
          const pair = samples.filter(
            (sample) => sample.iteration === iteration && sample.cache === cache
          )
          return (
            pair.find((sample) => sample.loader === "fork")!.elapsedMs /
            pair.find((sample) => sample.loader === "baseline")!.elapsedMs
          )
        })
        return [cache, { forkToBaselineRatios: ratios, medianRatio: median(ratios) }]
      })
    )
    const report = {
      node: node.stdout.trim(),
      executable,
      platform: process.platform,
      arch: process.arch,
      project,
      entry,
      workload,
      iterations,
      profiles: profileDirectory ?? null,
      loaders,
      cachePolicy:
        "Private bootstrap and compiler caches, reset for each cold pair; fresh processes; OS filesystem cache is not flushed",
      resources: {
        cpus: os.availableParallelism(),
        loadAverage: os.loadavg(),
        freeMemory: os.freemem()
      },
      summary,
      paired,
      samples
    }
    if (values.json) console.log(JSON.stringify(report))
    else {
      console.log(`${styleText("cyan", "Log4brains")} ${workload} (${report.node})`)
      console.log(JSON.stringify({ summary, paired }, null, 2))
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
