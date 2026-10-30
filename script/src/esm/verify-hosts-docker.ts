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
import { parseArgs, styleText } from "node:util"

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
        const child = spawn("docker", args, { cwd, stdio: "inherit" })
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
  assert.ok(Array.isArray(report.samples) && report.samples.length === 6, "Expected six host cases")
  const seen = new Set<string>()
  const samples: unknown[] = report.samples
  for (const sample of samples) {
    assert.ok(sample && typeof sample === "object")
    const entry = sample as Record<string, unknown>
    assert.ok(entry.issue === 867 || entry.issue === 915)
    assert.ok(["disabled", "cold", "warm"].includes(String(entry.phase)))
    assert.equal(entry.passed, true)
    seen.add(`${entry.issue}:${entry.phase}`)
  }
  assert.equal(seen.size, 6, "Duplicate or missing host cache phases")
}

export async function verifyHostsDocker(
  projectRoot = root,
  runner?: DockerRunner
): Promise<string> {
  const project = realpathSync(projectRoot)
  const client = dockerClient()
  const run = runner ?? client.run
  assert.equal(
    await run(["version", "--format", "{{.Server.Version}}"], project),
    0,
    "Docker daemon is unavailable"
  )
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
  console.log(`${styleText("cyan", "ARTIFACTS")} ${reports}`)
  try {
    console.log(`${styleText("cyan", "BUILD")} self-contained Linux host image`)
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
    assert.ok(!interrupted, "Host verification interrupted")
    assert.equal(buildCode, 0, `Docker build failed; artifacts: ${directory}`)
    image = readFileSync(imageFile, "utf8").trim()
    assert.match(image, /^sha256:[a-f0-9]{64}$/, "Docker did not write an image ID")
    attempted = true
    try {
      console.log(`${styleText("cyan", "RUN")} offline Electron 8 / VS Code 1.66.2 checks`)
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
          image
        ],
        project
      )
    } finally {
      // Keep the stopped container until diagnostics have been exported, including
      // failed runs. No source tree or external assets are mounted into it.
      const copyCode = await run(["cp", `${container}:/reports/.`, reports], project)
      assert.equal(copyCode, 0, `Could not export container diagnostics to ${reports}`)
    }
    assert.ok(!interrupted, `Host verification interrupted; reports: ${reports}`)
    assert.equal(runCode, 0, `Host container exited with ${runCode}; reports: ${reports}`)
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
  assert.equal(cleanupCode, 0, `Could not remove verification container ${container}`)
  console.log(
    `${styleText("green", "PASS")} Docker host verification; report: ${path.join(reports, "report.json")}`
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
      "pnpm verify:hosts:docker\nBuilds a cached Linux/amd64 image, runs both original host reproductions offline, and exports logs to .cache/host-verification. Requires Docker Engine/Desktop. No external assets or host display are needed."
    )
  } else {
    verifyHostsDocker().catch((error: unknown) => {
      console.error(`${styleText("red", "FAIL")} ${String(error)}`)
      process.exitCode = 1
    })
  }
}
