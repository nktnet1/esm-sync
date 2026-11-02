import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createWriteStream, realpathSync } from "node:fs"
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, styleText } from "node:util"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
type Step = {
  id: string
  label: string
  command: string
  args: string[]
  dependencies?: string[]
  env?: NodeJS.ProcessEnv
}
type Result = {
  id: string
  label: string
  status: "passed" | "failed" | "blocked"
  exitCode: number | null
  durationMs: number
  error?: string
}
type Execute = (step: Step, logFile: string) => Promise<number>
type Report = {
  nonce: string
  nodeMajor: number
  node: string
  platform: string
  arch: string
  passed: boolean
  results: Result[]
}

/** Respect terminal colour preferences while allowing explicit FORCE_COLOR in pipes. */
export function verificationColorsEnabled(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = Boolean(process.stdout.isTTY)
): boolean {
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0"
  if (
    env.NO_COLOR !== undefined ||
    env.NODE_DISABLE_COLORS !== undefined ||
    env.CLICOLOR === "0" ||
    env.TERM === "dumb"
  )
    return false
  if (env.CLICOLOR_FORCE !== undefined && env.CLICOLOR_FORCE !== "0") return true
  return isTTY
}

/** Child output is piped to both the terminal and log, so preserve TTY colour. */
export function verificationChildEnv(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = Boolean(process.stdout.isTTY)
): NodeJS.ProcessEnv {
  const childEnv = { ...env }
  if (verificationColorsEnabled(env, isTTY)) {
    childEnv.FORCE_COLOR ??= "1"
    // FORCE_COLOR takes precedence. Avoid Node's repeated conflicting-env warnings.
    delete childEnv.NO_COLOR
    delete childEnv.NODE_DISABLE_COLORS
  } else if (env.NO_COLOR !== undefined || env.NODE_DISABLE_COLORS !== undefined) {
    if (env.FORCE_COLOR === "0") delete childEnv.FORCE_COLOR
  } else if (env.FORCE_COLOR === undefined) {
    childEnv.FORCE_COLOR = "0"
  }
  return childEnv
}

function colorToken(color: Parameters<typeof styleText>[0], token: string): string {
  return verificationColorsEnabled() ? styleText(color, token, { validateStream: false }) : token
}

/** Compose the repository's existing package scripts; CI handles the version matrix. */
export function localVerificationSteps(reports: string): Step[] {
  const pnpm = (
    id: string,
    label: string,
    args: string[],
    dependencies: string[] = [],
    env: NodeJS.ProcessEnv = {}
  ): Step => ({ id, label, command: "pnpm", args, dependencies, env })
  return [
    pnpm("fixtures", "Prepare pinned vendor fixtures", ["fixtures:prepare"]),
    pnpm("lint", "Check formatting and lint", ["lint"]),
    pnpm("types", "Check implementation, tooling and declarations", ["typecheck"], ["fixtures"]),
    pnpm("unused", "Check unused code and dependencies", ["lint:unused"], ["fixtures"]),
    // CI also uses verify:prod; it builds with --prod --test and runs Vitest.
    pnpm(
      "production-tests",
      "Run the production build and all Vitest projects",
      ["verify:prod"],
      ["fixtures"]
    ),
    pnpm(
      "production-conformance",
      "Run complete production Test262 selection",
      [
        "test:conformance:run",
        "--reporter",
        "dot",
        "--report",
        path.join(reports, "production-test262.json")
      ],
      ["production-tests"],
      { NODE_ENV: "production", ESM_ENV: "production-test" }
    ),
    // The publishable build differs from the production test bundle.
    pnpm(
      "release-build",
      "Build the publishable production package",
      ["build:prod"],
      ["production-conformance"]
    ),
    pnpm(
      "release-packed",
      "Verify installed release CJS and ESM consumers",
      ["test:packed", "--format=both"],
      ["release-build"]
    ),
    pnpm(
      "startup",
      "Verify synthetic startup and cache workloads",
      ["benchmark:startup", "--json"],
      ["release-packed"]
    ),
    pnpm(
      "startup-await",
      "Verify async startup and cache workloads",
      ["benchmark:startup", "--await", "--json"],
      ["release-packed"]
    ),
    pnpm(
      "await-benchmark",
      "Verify native await and cached graph workloads",
      ["benchmark:await", "--json"],
      ["release-packed"]
    ),
    pnpm(
      "registry",
      "Verify disposable-registry publish and install",
      ["test:verdaccio"],
      ["release-packed"]
    ),
    pnpm("audit-all", "Audit production and development dependencies", ["audit:all"]),
    pnpm(
      "hosts",
      "Verify Electron, VS Code, native USB and WebContainer hosts",
      ["verify:hosts:docker"],
      ["release-packed"]
    )
  ]
}

export async function runSteps(
  steps: Step[],
  reports: string,
  execute: Execute
): Promise<Result[]> {
  const results: Result[] = []
  for (const [index, step] of steps.entries()) {
    const missing =
      step.dependencies?.filter(
        (id) => !results.some((value) => value.id === id && value.status === "passed")
      ) ?? []
    if (missing.length) {
      results.push({
        id: step.id,
        label: step.label,
        status: "blocked",
        exitCode: null,
        durationMs: 0,
        error: `Prerequisites failed: ${missing.join(", ")}`
      })
      console.log(`${colorToken("yellow", "BLOCKED")} ${step.label}: ${missing.join(", ")}`)
      await writeFile(path.join(reports, "steps.json"), JSON.stringify(results, null, 2) + "\n")
      continue
    }
    console.log(`\n[${index + 1}/${steps.length}] ${colorToken("cyan", "RUN")} ${step.label}`)
    const started = Date.now()
    let code: number | null = null
    let error: string | undefined
    try {
      code = await execute(step, path.join(reports, `${step.id}.log`))
    } catch (value) {
      error = value instanceof Error ? value.message : String(value)
    }
    const result: Result = {
      id: step.id,
      label: step.label,
      status: code === 0 ? "passed" : "failed",
      exitCode: code,
      durationMs: Date.now() - started,
      ...(error === undefined ? {} : { error })
    }
    results.push(result)
    console.log(
      `${colorToken(code === 0 ? "green" : "red", code === 0 ? "PASS" : "FAIL")} ${step.label}${error ? `: ${error}` : ""}`
    )
    // Save progress even when a later check is interrupted or the machine stops.
    await writeFile(path.join(reports, "steps.json"), JSON.stringify(results, null, 2) + "\n")
  }
  return results
}

function commandRunner(cwd: string): { execute: Execute; close: () => void } {
  let active: ReturnType<typeof spawn> | undefined
  let interrupted = false
  let force: ReturnType<typeof setTimeout> | undefined
  const stop = (child: ReturnType<typeof spawn>, signal: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, signal)
    } catch {
      child.kill(signal)
    }
  }
  const interrupt = () => {
    if (interrupted) return
    interrupted = true
    if (active?.pid) {
      stop(active, "SIGTERM")
      force = setTimeout(() => {
        if (active?.pid) stop(active, "SIGKILL")
      }, 10_000)
      force.unref()
    }
  }
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  return {
    close() {
      if (force) clearTimeout(force)
      process.removeListener("SIGINT", interrupt)
      process.removeListener("SIGTERM", interrupt)
    },
    execute(step, logFile) {
      if (interrupted) return Promise.reject(new Error("Verification interrupted"))
      return new Promise((resolve, reject) => {
        const log = createWriteStream(logFile)
        const child = spawn(step.command, step.args, {
          cwd,
          env: verificationChildEnv({ ...process.env, ...step.env }),
          shell: false,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"]
        })
        active = child
        let failure: Error | undefined
        child.stdout.pipe(process.stdout, { end: false })
        child.stdout.pipe(log, { end: false })
        child.stderr.pipe(process.stderr, { end: false })
        child.stderr.pipe(log, { end: false })
        log.once("error", (error) => {
          failure = error
          stop(child, "SIGKILL")
        })
        child.once("error", (error) => {
          if (active === child) active = undefined
          log.end()
          reject(error)
        })
        child.once("close", (code, signal) => {
          if (force) clearTimeout(force)
          if (active === child) active = undefined
          log.end(() => {
            if (failure) reject(failure)
            else if (signal) reject(new Error(`${step.label} terminated by ${signal}`))
            else resolve(code ?? 1)
          })
        })
      })
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      reports: { type: "string" },
      "babel-project": { type: "string" },
      "log4brains-project": { type: "string" }
    }
  })
  if (values.help) {
    console.log(
      "pnpm verify:all [--reports <parent>] [--babel-project <installed-project>] [--log4brains-project <installed-project>]\nUses the current Node.js runtime (22.18+), pnpm, installed development dependencies, a native build toolchain, and macOS or Linux. Orchestrates existing package.json scripts for production Vitest, Test262, release packaging, benchmarks, lint/types/unused checks, dependency audit, and Verdaccio. Regular checks run natively; Docker is needed only for host integration verification. Saves logs/reports; does not publish to npm. CI owns the Node/OS matrix."
    )
    return
  }
  const major = Number(process.versions.node.split(".")[0])
  assert.ok(
    process.platform === "linux" || process.platform === "darwin",
    "verify:all requires macOS or Linux"
  )
  // Production Vitest cleans .cache; dist is retained during test fixture resets.
  const parent = path.resolve(values.reports ?? path.join(root, "dist/verification"))
  await mkdir(parent, { recursive: true })
  const reports = await realpath(await mkdtemp(path.join(await realpath(parent), "run-")))
  const nonce = randomUUID()
  const runner = commandRunner(root)
  console.log(
    `\n${colorToken("cyan", "NODE")} ${process.version} (${process.platform}/${process.arch})`
  )
  let results: Result[] = []
  try {
    const steps = localVerificationSteps(reports)
    if (values["babel-project"])
      steps.push({
        id: "babel-original",
        label: "Verify installed original Babel application",
        command: "pnpm",
        dependencies: ["release-packed"],
        args: ["verify:babel-repro", `--project=${realpathSync(values["babel-project"])}`, "--json"]
      })
    if (values["log4brains-project"])
      for (const workload of ["version", "preview"])
        steps.push({
          id: `log4brains-${workload}`,
          label: `Verify original Log4brains ${workload}`,
          command: "pnpm",
          dependencies: ["release-packed"],
          args: [
            "benchmark:log4brains",
            `--project=${realpathSync(values["log4brains-project"])}`,
            `--workload=${workload}`,
            "--json"
          ]
        })
    results = await runSteps(steps, reports, runner.execute)
  } finally {
    runner.close()
    const report: Report = {
      nonce,
      nodeMajor: major,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      passed: results.length > 0 && results.every((result) => result.status === "passed"),
      results
    }
    await writeFile(path.join(reports, "summary.json"), JSON.stringify(report, null, 2) + "\n")
    console.log(`\nREPORT ${path.join(reports, "summary.json")}`)
  }
  const failed = results.filter((result) => result.status !== "passed")
  process.exitCode = failed.length ? 1 : 0
  console.log(
    `${colorToken(failed.length ? "red" : "green", failed.length ? "FAIL" : "PASS")} ${results.length - failed.length}/${results.length} verification stages`
  )
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
