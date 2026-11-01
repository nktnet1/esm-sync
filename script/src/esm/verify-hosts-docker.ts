import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { validateUsbNativeEvidence } from "./verify-host-usb.ts"
import { hostLabel } from "./host-output.ts"
import { HostVerificationBlocked, runDockerHostChecks } from "./host-docker-run.ts"

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
    validateUsbNativeEvidence(item)
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
  const client = dockerClient()
  return runDockerHostChecks(
    projectRoot,
    { run: runner ?? client.run, cancel: client.cancel, native: !runner },
    validateDockerReport
  )
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const { values } = parseArgs({ options: { help: { type: "boolean", short: "h" } } })
  if (values.help) {
    console.log(
      "pnpm verify:hosts:docker\nAutomatically downloads verified build inputs, applies the native USB queue fix, builds ABIs 64/70 in Docker, and verifies safe rejection, require/import and queue liveness in every cache mode. Original published/unpatched binaries are retained as negative controls. No manual USB installation or rebuild command is needed. Runs offline Linux/amd64 host and USB checks, then automatically boots a real WebContainer in Chromium and runs all three cache modes plus consumer builds. macOS and Linux Docker hosts are supported. Only the WebContainer phase needs network access. Exit 0: pass; 1: failure; 2: native USB or WebContainer environment blocker. Reports: .cache/host-verification. No manual upload, external assets or host display."
    )
  } else {
    verifyHostsDocker().catch((error: unknown) => {
      console.error(
        `\n${hostLabel(error instanceof HostVerificationBlocked ? "yellow" : "red", error instanceof HostVerificationBlocked ? "BLOCKED" : "FAIL")} ${error instanceof Error ? error.message : String(error)}\n`
      )
      process.exitCode = error instanceof HostVerificationBlocked ? 2 : 1
    })
  }
}
