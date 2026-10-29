import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { styleText } from "node:util"

interface Timings {
  samples: number[]
  median: number
  min: number
  max: number
}

const root = path.resolve(path.dirname(realpathSync(process.argv[1]!)), "../..")
const defaultLoader = path.join(root, "dist/esm.js")

function parseArguments(args: string[]): {
  iterations: number
  json: boolean
  moduleCount: number
  loader: string
} {
  let iterations = 5
  let json = false
  let moduleCount = 16
  let loader = defaultLoader
  for (const arg of args) {
    if (arg === "--json") {
      json = true
    } else if (arg.startsWith("--iterations=")) {
      const value = Number(arg.slice("--iterations=".length))
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error("--iterations must be an integer between 1 and 100")
      }
      iterations = value
    } else if (arg.startsWith("--modules=")) {
      moduleCount = Number(arg.slice("--modules=".length))
      if (!Number.isInteger(moduleCount) || moduleCount < 1 || moduleCount > 1000) {
        throw new Error("--modules must be an integer between 1 and 1000")
      }
    } else if (arg.startsWith("--loader=")) {
      loader = realpathSync(path.resolve(arg.slice("--loader=".length)))
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return { iterations, json, moduleCount, loader }
}

function generateFixture(directory: string, moduleCount: number): void {
  for (const [kind, extension] of [
    ["native", "mjs"],
    ["loader", "js"]
  ] as const) {
    const location = path.join(directory, kind)
    mkdirSync(location)
    const imports: string[] = []
    for (let index = 1; index <= moduleCount; index++) {
      const name = `module-${index}.${extension}`
      writeFileSync(path.join(location, name), `export const number = ${index}\n`)
      imports.push(`import { number as n${index} } from './${name}'`)
    }
    const total = Array.from({ length: moduleCount }, (_, index) => `n${index + 1}`).join(" + ")
    writeFileSync(
      path.join(location, `index.${extension}`),
      `${imports.join("\n")}\nconsole.log('startup:' + (${total}))\n`
    )
  }
}

function run(
  directory: string,
  kind: "native" | "loader",
  cache: string,
  loader: string,
  moduleCount: number
): number {
  const loaderMode = kind === "loader"
  const cwd = path.join(directory, kind)
  const args = loaderMode ? ["-r", loader, "index.js"] : ["index.mjs"]
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  delete env.ESM_DISABLE_CACHE
  if (loaderMode) {
    env.ESM_OPTIONS = JSON.stringify({ cache, cjs: true, mode: "auto" })
  } else {
    delete env.ESM_OPTIONS
  }
  const started = performance.now()
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 45_000,
    windowsHide: true
  })
  const elapsed = performance.now() - started
  if (result.error || result.status !== 0) {
    throw new Error(
      `${kind} startup failed: ${result.error?.message ?? result.stderr ?? result.signal ?? result.status}`
    )
  }
  if (result.stdout.trim() !== `startup:${(moduleCount * (moduleCount + 1)) / 2}`) {
    throw new Error(`${kind} startup returned unexpected output: ${result.stdout}`)
  }
  return Number(elapsed.toFixed(2))
}

function summarise(samples: number[]): Timings {
  const sorted = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return {
    samples,
    median: sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!
  }
}

function main(): void {
  const { iterations, json, moduleCount, loader } = parseArguments(process.argv.slice(2))
  if (!existsSync(loader)) throw new Error("Build esm-sync before running the benchmark")

  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-sync-startup-")))
  const cache = path.join(directory, "esm-cache")
  const samples = { native: [] as number[], esmCold: [] as number[], esmWarm: [] as number[] }
  try {
    generateFixture(directory, moduleCount)
    for (let index = 0; index < iterations; index++) {
      samples.native.push(run(directory, "native", cache, loader, moduleCount))
      rmSync(cache, { recursive: true, force: true })
      samples.esmCold.push(run(directory, "loader", cache, loader, moduleCount))
      if (!existsSync(cache)) throw new Error("esm-sync did not create the compiler cache")
      samples.esmWarm.push(run(directory, "loader", cache, loader, moduleCount))
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }

  const report = {
    node: process.version,
    platform: process.platform,
    iterations,
    moduleCount,
    loader: realpathSync(loader),
    timings: {
      native: summarise(samples.native),
      esmCold: summarise(samples.esmCold),
      esmWarm: summarise(samples.esmWarm)
    }
  }
  if (json) {
    console.log(JSON.stringify(report))
  } else {
    console.log(`${styleText("cyan", "Startup benchmark")} (${report.node}, ${iterations} runs)`)
    for (const [name, result] of Object.entries(report.timings)) {
      console.log(
        `${name.padEnd(8)} median ${result.median.toFixed(2)} ms (${result.min.toFixed(2)}-${result.max.toFixed(2)} ms)`
      )
    }
    console.log("Cold resets the loader compiler cache; warm reuses it in a fresh Node process.")
    console.log("Native runs are a baseline, not a cold/warm compiler-cache comparison.")
  }
}

main()
