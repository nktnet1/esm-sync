import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { hostColorsEnabled, hostLabel, hostSection } from "./host-output.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
export type DockerRunner = (args: string[], cwd: string) => Promise<number>

function dockerClient(): { run: DockerRunner; cancel: () => void } {
  let active: ReturnType<typeof spawn> | undefined
  return {
    cancel() {
      active?.kill("SIGTERM")
    },
    run(args, cwd) {
      return new Promise((resolve, reject) => {
        const quiet = ["version", "cp", "rm"].includes(args[0] ?? "")
        const child = spawn("docker", args, {
          cwd,
          stdio: ["ignore", quiet ? "ignore" : "inherit", "inherit"]
        })
        active = child
        const timeout = args[0] === "build" ? 1_800_000 : args[0] === "run" ? 600_000 : 30_000
        const timer = setTimeout(() => child.kill("SIGKILL"), timeout)
        function cleanup(): void {
          clearTimeout(timer)
          active = undefined
        }
        child.once("error", (error) => {
          cleanup()
          reject(new Error(`Docker Engine/Desktop and its CLI are required: ${error.message}`))
        })
        child.once("close", (code) => {
          cleanup()
          resolve(code ?? 1)
        })
      })
    }
  }
}

function validateDockerReport(value: unknown): void {
  assert.ok(value && typeof value === "object", "Missing host verification report")
  const report = value as Record<string, unknown>
  assert.equal(report.passed, true, "Container reported failed host verification")
  assert.match(String(report.loaderSHA256), /^[a-f0-9]{64}$/, "Missing tested loader digest")
  assert.ok(
    Array.isArray(report.samples) && report.samples.length === 12,
    "Expected twelve host cases"
  )
  const seen = new Set<string>()
  const samples: unknown[] = report.samples
  for (const sample of samples) {
    assert.ok(sample && typeof sample === "object")
    const entry = sample as Record<string, unknown>
    assert.ok(
      entry.issue === 691 || entry.issue === 817 || entry.issue === 867 || entry.issue === 915
    )
    assert.ok(["disabled", "cold", "warm"].includes(String(entry.phase)))
    assert.equal(entry.passed, true)
    if (entry.issue === 817) assert.equal(entry.scope, "minimal-native-addon")
    if (entry.issue === 691) assert.equal(entry.scope, "reconstructed-renderer")
    seen.add(`${entry.issue}:${entry.phase}`)
  }
  assert.equal(seen.size, 12, "Duplicate or missing host cache phases")
}

export async function verifyHostsDocker(
  projectRoot = root,
  runner?: DockerRunner
): Promise<string> {
  const project = realpathSync(projectRoot)
  const client = dockerClient()
  const run = runner ?? client.run
  if ((await run(["version", "--format", "{{.Server.Version}}"], project)) !== 0)
    throw new Error("Docker daemon is unavailable")
  const base = path.join(project, ".cache/host-verification")
  mkdirSync(base, { recursive: true })
  const directory = realpathSync(mkdtempSync(path.join(realpathSync(base), "run-")))
  const reports = path.join(directory, "reports")
  mkdirSync(reports)
  const imageFile = path.join(directory, "image-id")
  const container = "esm-sync-hosts-" + randomUUID()
  let attempted = false
  let interrupted = false
  let image = ""
  let runCode: number | null = null
  let cleanupCode: number | null = null
  const onInterrupt = () => {
    interrupted = true
    client.cancel()
    if (attempted && !runner)
      spawnSync("docker", ["stop", "--time", "1", container], { stdio: "ignore", timeout: 10_000 })
  }
  const onExit = () => {
    if (attempted && !runner)
      spawnSync("docker", ["rm", "--force", container], { stdio: "ignore", timeout: 10_000 })
  }
  process.once("SIGINT", onInterrupt)
  process.once("SIGTERM", onInterrupt)
  process.once("exit", onExit)
  console.log(`\n${hostLabel("cyan", "REPORTS")} ${reports}`)
  try {
    hostSection(1, 3, "Build the self-contained Linux host image")
    const buildCode = await run(
      [
        "build",
        "--platform",
        "linux/amd64",
        "--file",
        "script/docker/hosts.Dockerfile",
        "--tag",
        "esm-sync-hosts:local",
        "--iidfile",
        imageFile,
        "."
      ],
      project
    )
    if (interrupted) throw new Error("Host verification interrupted")
    if (buildCode !== 0)
      throw new Error(`Docker build failed (exit ${buildCode}); reports: ${reports}`)
    image = readFileSync(imageFile, "utf8").trim()
    assert.match(image, /^sha256:[a-f0-9]{64}$/, "Docker did not write an image ID")
    attempted = true
    let copyCode: number | null = null
    try {
      hostSection(2, 3, "Run twelve offline Electron / VS Code checks")
      runCode = await run(
        [
          "run",
          "--name",
          container,
          "--platform",
          "linux/amd64",
          "--init",
          "--network",
          "none",
          "--shm-size",
          "1g",
          "--env",
          `FORCE_COLOR=${hostColorsEnabled() ? "1" : "0"}`,
          image
        ],
        project
      )
    } finally {
      // Keep the stopped container until diagnostics have been exported, including
      // failed runs. No source tree or external assets are mounted into it.
      hostSection(3, 3, "Export diagnostics and remove the test container")
      copyCode = await run(["cp", `${container}:/reports/.`, reports], project)
    }
    if (copyCode !== 0) throw new Error(`Could not export container diagnostics to ${reports}`)
    if (interrupted) throw new Error(`Host verification interrupted; reports: ${reports}`)
    if (runCode !== 0)
      throw new Error(`Host verification failed (container exit ${runCode}). Reports: ${reports}`)
    const output = path.join(reports, "report.json")
    assert.ok(existsSync(output), `Container wrote no verification report: ${output}`)
    validateDockerReport(JSON.parse(readFileSync(output, "utf8")) as unknown)
  } finally {
    try {
      if (attempted) cleanupCode = await run(["rm", "--force", container], project)
    } finally {
      process.removeListener("SIGINT", onInterrupt)
      process.removeListener("SIGTERM", onInterrupt)
      process.removeListener("exit", onExit)
      writeFileSync(
        path.join(reports, "docker.json"),
        JSON.stringify(
          { image, container, platform: "linux/amd64", exitCode: runCode, cleanupCode },
          null,
          2
        )
      )
    }
  }
  if (cleanupCode !== 0) throw new Error(`Could not remove verification container ${container}`)
  console.log(
    `${hostLabel("green", "PASS")} Docker host verification\n\n${hostLabel("cyan", "REPORT")} ${path.join(reports, "report.json")}\n`
  )
  return reports
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const { values } = parseArgs({ options: { help: { type: "boolean", short: "h" } } })
  if (values.help) {
    console.log(
      "pnpm verify:hosts:docker\nBuilds a cached Linux/amd64 image, runs the #867/#915 originals and the #691 renderer reconstruction offline, and exports logs to .cache/host-verification. Requires Docker Engine/Desktop. No external assets or host display are needed."
    )
  } else {
    verifyHostsDocker().catch((error: unknown) => {
      console.error(
        `\n${hostLabel("red", "FAIL")} ${error instanceof Error ? error.message : String(error)}\n`
      )
      process.exitCode = 1
    })
  }
}
