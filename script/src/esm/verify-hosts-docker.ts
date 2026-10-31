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

class HostVerificationBlocked extends Error {}

function validateDockerReport(value: unknown, blocked = false): void {
  assert.ok(value && typeof value === "object", "Missing host verification report")
  const report = value as Record<string, unknown>
  assert.equal(report.passed, !blocked, "Unexpected host verification outcome")
  assert.equal(report.controlsPassed, true, "Container reported failed regression checks")
  if (blocked)
    assert.equal(report.blocked, true, "Container did not substantiate a native USB blocker")
  assert.match(String(report.loaderSHA256), /^[a-f0-9]{64}$/, "Missing tested loader digest")
  assert.ok(
    Array.isArray(report.samples) && report.samples.length === 15,
    "Expected fifteen regression cases"
  )
  const seen = new Set<string>()
  const samples: unknown[] = report.samples
  for (const sample of samples) {
    assert.ok(sample && typeof sample === "object")
    const entry = sample as Record<string, unknown>
    assert.ok(
      entry.issue === 691 ||
        entry.issue === 817 ||
        entry.issue === 867 ||
        entry.issue === 915 ||
        entry.issue === 917
    )
    assert.ok(["disabled", "cold", "warm"].includes(String(entry.phase)))
    assert.equal(entry.passed, true)
    if (entry.issue === 817) assert.equal(entry.scope, "minimal-native-addon")
    if (entry.issue === 691) assert.equal(entry.scope, "reconstructed-renderer")
    if (entry.issue === 917) assert.equal(entry.scope, "shared-realm-vm-regression")
    seen.add(`${entry.issue}:${entry.phase}`)
  }
  assert.equal(seen.size, 15, "Duplicate or missing regression cache phases")
  assert.ok(Array.isArray(report.usb) && report.usb.length === 3, "Missing full USB verification")
  const phases = new Set<string>()
  const usb: unknown[] = report.usb
  for (const item of usb) {
    assert.ok(item && typeof item === "object")
    const verdict = item as Record<string, unknown>
    assert.ok(["disabled", "cold", "warm"].includes(String(verdict.phase)))
    phases.add(String(verdict.phase))
    assert.ok(
      verdict.status === "resolved" || (blocked && verdict.status === "blocked"),
      "Full USB verification failed"
    )
    assert.ok(Array.isArray(verdict.runs) && verdict.runs.length === 4, "Missing USB controls")
    const controls = new Set<string>()
    for (const run of verdict.runs as Record<string, unknown>[]) {
      assert.ok(run.mode === "require" || run.mode === "import")
      assert.ok(run.binary === "mismatch" || run.binary === "compatible")
      controls.add(`${run.mode}:${run.binary}`)
      if (verdict.status === "resolved" || run.binary === "compatible")
        assert.equal(run.passed, true, "A required USB control failed")
    }
    assert.equal(controls.size, 4, "Duplicate USB control")
    if (verdict.status === "blocked") {
      const ordinary = (verdict.runs as Record<string, unknown>[]).find(
        (run) => run.mode === "require" && run.binary === "mismatch"
      )!
      assert.equal(
        ordinary.passed,
        false,
        "A blocked USB verdict must have a failed ordinary control"
      )
      assert.ok(
        ordinary.signal || ordinary.timedOut || ordinary.code !== 0,
        "No native crash or hang was recorded"
      )
      assert.ok(ordinary.report && typeof ordinary.report === "object")
      const evidence = ordinary.report as Record<string, unknown>
      assert.ok(
        Array.isArray(evidence.rejections) &&
          evidence.rejections.some(
            (error: unknown) =>
              typeof error === "string" &&
              /NODE_MODULE_VERSION 64/.test(error) &&
              /NODE_MODULE_VERSION 70/.test(error)
          ),
        "Native blocker lacks the matching ABI error"
      )
    }
  }
  assert.equal(phases.size, 3, "Duplicate full USB cache phase")
  if (blocked)
    assert.ok(
      usb.some((item) => (item as Record<string, unknown>).status === "blocked"),
      "Missing native blocker"
    )
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
      hostSection(2, 3, "Run fifteen offline host/VM regression checks and full USB verification")
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
    if (runCode !== 0 && runCode !== 2)
      throw new Error(`Host verification failed (container exit ${runCode}). Reports: ${reports}`)
    const output = path.join(reports, "report.json")
    assert.ok(existsSync(output), `Container wrote no verification report: ${output}`)
    validateDockerReport(JSON.parse(readFileSync(output, "utf8")) as unknown, runCode === 2)
    if (runCode === 2)
      throw new HostVerificationBlocked(
        `Regression checks pass; #817 full USB is BLOCKED by an ordinary-require native crash. Reports: ${reports}\nWebContainer test kit: ${path.join(reports, "webcontainer-check.zip")}`
      )
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
    `${hostLabel("green", "PASS")} Docker host verification\n\n${hostLabel("cyan", "REPORT")} ${path.join(reports, "report.json")}\nWebContainer test kit: ${path.join(reports, "webcontainer-check.zip")}\n`
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
      "pnpm verify:hosts:docker\nRuns fifteen offline regression checks for #867/#915/#691/#817/#917, plus real USB ABI and rebuilt controls. Exit 0: all checks pass; 1: failure; 2: full USB verification blocked by a native ordinary-require failure. #917's real WebContainer command is pnpm verify:webcontainer. Reports: .cache/host-verification. Requires Docker Engine/Desktop. No external assets or host display."
    )
  } else {
    verifyHostsDocker().catch((error: unknown) => {
      console.error(
        `\n${hostLabel("red", "FAIL")} ${error instanceof Error ? error.message : String(error)}\n`
      )
      process.exitCode = error instanceof HostVerificationBlocked ? 2 : 1
    })
  }
}
