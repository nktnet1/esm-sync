import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createWriteStream, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, styleText } from "node:util"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const versions = [22, 24, 26] as const
type Step = {
  id: string
  label: string
  command: string
  args: string[]
  dependencies?: string[]
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}
type Result = {
  id: string
  label: string
  status: "passed" | "failed" | "blocked"
  exitCode: number | null
  durationMs: number
  error?: string
}
type Execute = (step: Step, logFile: string, cleanup?: boolean) => Promise<number>
type Report = {
  nonce: string
  nodeMajor: number
  node: string
  platform: string
  arch: string
  passed: boolean
  results: Result[]
}

export function workerSteps(major: number, reports: string): Step[] {
  assert.ok(
    versions.some((value) => value === major),
    "Expected Node 22, 24 or 26"
  )
  const pnpm = (
    id: string,
    label: string,
    args: string[],
    dependencies: string[] = [],
    env: NodeJS.ProcessEnv = {}
  ): Step => ({ id, label, command: "pnpm", args, dependencies, env })
  const steps = [pnpm("fixtures", "Prepare pinned vendor fixtures", ["fixtures:prepare"])]
  if (major === 24)
    steps.push(
      pnpm("lint", "Check formatting and lint", ["lint"]),
      pnpm("types", "Check implementation, tooling and declarations", ["typecheck"]),
      pnpm("unused", "Check unused code and dependencies", ["lint:unused"])
    )
  for (const mode of ["development", "production"]) {
    const build = `${mode}-build`
    const env = { NODE_ENV: mode, ESM_ENV: `${mode}-test` }
    steps.push(
      pnpm(
        build,
        `Build ${mode} test bundles and native bridge`,
        ["build", ...(mode === "production" ? ["--prod"] : []), "--test"],
        ["fixtures"],
        env
      ),
      pnpm(
        `${mode}-tests`,
        `Run every ${mode} Vitest project`,
        [mode === "production" ? "test:run:prod" : "test:run"],
        [build],
        env
      ),
      pnpm(
        `${mode}-conformance`,
        `Run complete ${mode} Test262 selection`,
        [
          "test:conformance:run",
          "--reporter",
          "dot",
          "--report",
          path.join(reports, `${mode}-test262.json`)
        ],
        [build],
        env
      ),
      pnpm(
        `${mode}-packed`,
        `Verify installed ${mode} CJS and ESM packages`,
        ["test:packed", "--format=both"],
        [build],
        env
      )
    )
  }
  steps.push(
    pnpm("release-build", "Build the actual release artifact", ["build:prod"], ["fixtures"]),
    pnpm(
      "release-packed",
      "Verify installed release CJS and ESM consumers",
      ["test:packed", "--format=both"],
      ["release-build"],
      { NODE_ENV: "production" }
    ),
    pnpm(
      "startup",
      "Verify synthetic startup and cache workloads",
      ["benchmark:startup", "--json"],
      ["release-build"]
    ),
    pnpm(
      "startup-await",
      "Verify async startup and cache workloads",
      ["benchmark:startup", "--await", "--json"],
      ["release-build"]
    ),
    pnpm(
      "await-benchmark",
      "Verify native await and cached graph workloads",
      ["benchmark:await", "--json"],
      ["release-build"]
    )
  )
  if (major === 24)
    steps.push(
      pnpm(
        "registry",
        "Verify disposable-registry publish, install and worker consumers",
        ["test:verdaccio"],
        ["release-build"]
      ),
      pnpm("audit-production", "Audit production dependencies", ["audit:prod"]),
      pnpm("audit-all", "Audit development and production dependencies", ["audit:all"])
    )
  return steps
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
      console.log(`${styleText("yellow", "BLOCKED")} ${step.label}: ${missing.join(", ")}`)
      await writeFile(path.join(reports, "steps.json"), JSON.stringify(results, null, 2) + "\n")
      continue
    }
    console.log(`\n[${index + 1}/${steps.length}] ${styleText("cyan", "RUN")} ${step.label}`)
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
      `${styleText(code === 0 ? "green" : "red", code === 0 ? "PASS" : "FAIL")} ${step.label}${error ? `: ${error}` : ""}`
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
    execute(step, logFile, cleanup = false) {
      if (interrupted && !cleanup) return Promise.reject(new Error("Verification interrupted"))
      return new Promise((resolve, reject) => {
        const log = createWriteStream(logFile)
        const child = spawn(step.command, step.args, {
          cwd,
          env: { ...process.env, ...step.env },
          shell: false,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"]
        })
        active = child
        let failure: Error | undefined
        const timer = step.timeoutMs
          ? setTimeout(() => {
              failure = new Error(`${step.label} exceeded ${step.timeoutMs} ms`)
              stop(child, "SIGKILL")
            }, step.timeoutMs)
          : undefined
        timer?.unref()
        child.stdout.pipe(process.stdout, { end: false })
        child.stdout.pipe(log, { end: false })
        child.stderr.pipe(process.stderr, { end: false })
        child.stderr.pipe(log, { end: false })
        log.once("error", (error) => {
          failure = error
          stop(child, "SIGKILL")
        })
        child.once("error", (error) => {
          if (timer) clearTimeout(timer)
          if (active === child) active = undefined
          log.end()
          reject(error)
        })
        child.once("close", (code, signal) => {
          if (force) clearTimeout(force)
          if (timer) clearTimeout(timer)
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

function object(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Invalid verification report"
  )
  return value as Record<string, unknown>
}

export function validateWorkerReport(
  value: unknown,
  major: number,
  nonce: string,
  exitCode: number
): void {
  const report = object(value)
  assert.equal(report.nonce, nonce, "Worker report belongs to another run")
  assert.equal(report.nodeMajor, major, "Worker used the wrong Node version")
  assert.match(String(report.node), new RegExp(`^v${major}\\.\\d+\\.\\d+$`))
  assert.equal(report.platform, "linux")
  assert.equal(report.arch, "x64")
  assert.equal(report.passed, exitCode === 0)
  assert.ok(Array.isArray(report.results))
  const results: unknown[] = report.results
  const expected = workerSteps(major, "/reports").map((step) => step.id)
  assert.deepEqual(
    results.map((result) => object(result).id),
    expected,
    "Worker omitted or reordered a check"
  )
  if (exitCode === 0)
    for (const result of results) {
      assert.equal(
        object(result).status,
        "passed",
        "Worker reported success with incomplete checks"
      )
      assert.equal(object(result).exitCode, 0)
    }
}

export async function runMatrix(
  major: number,
  reports: string,
  pnpmVersion: string,
  execute: Execute
): Promise<number> {
  const name = `esm-sync-verify-${major}-${randomUUID()}`
  const nonce = randomUUID()
  const iid = path.join(reports, "image-id")
  const docker = (id: string, args: string[], cleanup = false) =>
    execute(
      {
        id,
        label: `Node ${major}: ${id}`,
        command: "docker",
        args,
        timeoutMs: id === "build" ? 1_800_000 : id === "run" ? 28_800_000 : 30_000
      },
      path.join(reports, `${id}.log`),
      cleanup
    )
  let attempted = false
  try {
    const build = await docker("build", [
      "build",
      "--platform",
      "linux/amd64",
      "--file",
      "script/docker/verify-all.Dockerfile",
      "--build-arg",
      `NODE_MAJOR=${major}`,
      "--build-arg",
      `PNPM_VERSION=${pnpmVersion}`,
      "--iidfile",
      iid,
      "."
    ])
    if (build !== 0) return build
    const image = (await readFile(iid, "utf8")).trim()
    assert.match(image, /^sha256:[a-f0-9]{64}$/, "Docker did not identify the built image")
    attempted = true
    const code = await docker("run", [
      "run",
      "--platform",
      "linux/amd64",
      "--init",
      "--name",
      name,
      image,
      "node",
      "script/src/esm/verify-all.ts",
      "--worker",
      "--reports",
      "/reports",
      "--nonce",
      nonce
    ])
    const copy = await docker("export", ["cp", `${name}:/reports/.`, reports], true)
    assert.equal(copy, 0, "Cannot export worker reports")
    validateWorkerReport(
      JSON.parse(await readFile(path.join(reports, "summary.json"), "utf8")) as unknown,
      major,
      nonce,
      code
    )
    return code
  } finally {
    if (attempted)
      assert.equal(
        await docker("cleanup", ["rm", "--force", name], true),
        0,
        "Cannot remove the verification container"
      )
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      worker: { type: "boolean" },
      reports: { type: "string" },
      nonce: { type: "string" },
      "babel-project": { type: "string" },
      "log4brains-project": { type: "string" }
    }
  })
  if (values.help) {
    console.log(
      "pnpm verify:all [--reports <parent>] [--babel-project <installed-project>] [--log4brains-project <installed-project>]\nRequires Node 24+ and Docker Engine/Desktop on macOS or Linux. Runs complete development/production suites, Test262, installed packages and benchmarks on Node 22/24/26 in Linux/amd64 containers, plus lint/types/unused checks, audits, a disposable registry and automatic real-host verification. Saves logs/reports and removes containers. No production publishing. Optional original-application checks use the supplied installed projects and local development tooling."
    )
    return
  }
  const major = Number(process.versions.node.split(".")[0])
  assert.ok(
    process.platform === "linux" || process.platform === "darwin",
    "verify:all requires macOS or Linux"
  )
  assert.ok(values.worker || major >= 24, "Run verify:all with Node 24 or newer")
  const parent = path.resolve(values.reports ?? path.join(root, ".cache/verification"))
  await mkdir(parent, { recursive: true })
  const reports = values.worker
    ? await realpath(parent)
    : await realpath(await mkdtemp(path.join(await realpath(parent), "run-")))
  const nonce = values.nonce ?? randomUUID()
  const runner = commandRunner(root)
  let results: Result[] = []
  try {
    if (values.worker)
      results = await runSteps(workerSteps(major, reports), reports, runner.execute)
    else {
      const preflight = await runner.execute(
        {
          id: "docker",
          label: "Check Docker daemon",
          command: "docker",
          args: ["version", "--format", "{{.Server.Version}}"],
          timeoutMs: 30_000
        },
        path.join(reports, "docker.log")
      )
      assert.equal(preflight, 0, "Docker Engine/Desktop and a running daemon are required")
      const manifest = object(
        JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as unknown
      )
      assert.equal(typeof manifest.packageManager, "string")
      const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager as string)
      assert.ok(match, "packageManager must pin an exact pnpm version")
      const steps: Step[] = versions.map((version) => ({
        id: `node-${version}`,
        label: `Complete verification on Node ${version}`,
        command: "matrix",
        args: [String(version)]
      }))
      steps.push({
        id: "hosts",
        label: "Offline Electron/VS Code/USB and real WebContainer verification",
        command: process.execPath,
        args: ["script/src/esm/verify-hosts-docker.ts"]
      })
      if (values["babel-project"] || values["log4brains-project"])
        steps.push(
          {
            id: "original-fixtures",
            label: "Prepare local Acorn source for original applications",
            command: process.execPath,
            args: ["script/src/esm/cli.ts", "setup-fixtures", "acorn"]
          },
          {
            id: "original-release",
            label: "Build the local release for original applications",
            command: process.execPath,
            args: ["script/src/esm/cli.ts", "build", "--prod"],
            dependencies: ["original-fixtures"]
          }
        )
      if (values["babel-project"])
        steps.push({
          id: "babel-original",
          label: "Verify installed original Babel application",
          command: process.execPath,
          dependencies: ["original-release"],
          args: [
            "script/src/esm/cli.ts",
            "verify-babel-repro",
            `--project=${realpathSync(values["babel-project"])}`,
            "--json"
          ]
        })
      if (values["log4brains-project"])
        for (const workload of ["version", "preview"])
          steps.push({
            id: `log4brains-${workload}`,
            label: `Verify original Log4brains ${workload}`,
            command: process.execPath,
            dependencies: ["original-release"],
            args: [
              "script/src/esm/cli.ts",
              "benchmark-log4brains",
              `--project=${realpathSync(values["log4brains-project"])}`,
              `--workload=${workload}`,
              "--json"
            ]
          })
      results = await runSteps(steps, reports, async (step, log) => {
        if (step.command !== "matrix") return runner.execute(step, log)
        const directory = path.join(reports, step.id)
        await mkdir(directory)
        return runMatrix(Number(step.args[0]), await realpath(directory), match[1]!, runner.execute)
      })
    }
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
    `${styleText(failed.length ? "red" : "green", failed.length ? "FAIL" : "PASS")} ${results.length - failed.length}/${results.length} verification stages`
  )
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
