import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs"
import os from "node:os"
import path from "node:path"
import type { DockerRunner } from "./verify-hosts-docker.ts"
import { hostColorsEnabled, hostFailureText, hostLabel, hostSection } from "./host-output.ts"
import { object, validateWebContainerBrowserReport } from "./verify-webcontainer-browser.ts"

export class HostVerificationBlocked extends Error {}
type Client = { run: DockerRunner; cancel: () => void; native: boolean }

export async function runDockerHostChecks(
  projectRoot: string,
  client: Client,
  validateOffline: (value: unknown, blocked?: boolean) => void
): Promise<string> {
  const project = realpathSync(projectRoot),
    run = client.run
  if ((await run(["version", "--format", "{{.Server.Version}}"], project)) !== 0)
    throw new Error("Docker daemon is unavailable")
  const base = path.join(project, ".cache/host-verification")
  mkdirSync(base, { recursive: true })
  const directory = realpathSync(mkdtempSync(path.join(realpathSync(base), "run-")))
  const reports = path.join(directory, "reports"),
    offlineDir = path.join(reports, "offline"),
    webDir = path.join(reports, "webcontainer")
  mkdirSync(offlineDir, { recursive: true })
  mkdirSync(webDir)
  const imageFile = path.join(directory, "image-id"),
    name = "esm-sync-hosts-" + randomUUID()
  const offlineName = name + "-offline",
    webName = name + "-webcontainer",
    nonce = randomUUID()
  const attempted = new Set<string>(),
    copies: Record<string, number> = {},
    cleanup: Record<string, number> = {}
  let image = "",
    interrupted = false,
    offlineCode: number | null = null,
    webCode: number | null = null
  const onInterrupt = () => {
    interrupted = true
    client.cancel()
    if (client.native)
      for (const container of attempted)
        spawnSync("docker", ["stop", "--time", "1", container], {
          stdio: "ignore",
          timeout: 10_000
        })
  }
  const onExit = () => {
    if (client.native)
      for (const container of attempted)
        spawnSync("docker", ["rm", "--force", container], { stdio: "ignore", timeout: 10_000 })
  }
  process.once("SIGINT", onInterrupt)
  process.once("SIGTERM", onInterrupt)
  process.once("exit", onExit)
  console.log(
    `\n${hostLabel("cyan", "TARGET")} Linux/amd64 containers; runner ${os.platform()}/${os.arch()}. Docker Desktop on macOS is supported.\n${hostLabel("cyan", "REPORTS")} ${reports}`
  )
  const output = path.join(reports, "report.json")
  function load(file: string): unknown {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as unknown) : null
  }
  try {
    hostSection(1, 4, "Build the Linux host image and browser tools")
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
    try {
      hostSection(2, 4, "Run offline Electron / VS Code regressions and full USB controls")
      attempted.add(offlineName)
      offlineCode = await run(
        [
          "run",
          "--name",
          offlineName,
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
      if (interrupted) throw new Error("Host verification interrupted")
      hostSection(3, 4, "Run real WebContainer verification automatically in Chromium (online)")
      attempted.add(webName)
      const networkEnv = [
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "NO_PROXY",
        "https_proxy",
        "http_proxy",
        "no_proxy"
      ]
        .filter((key) => process.env[key] !== undefined)
        .flatMap((key) => ["--env", key])
      webCode = await run(
        [
          "run",
          "--name",
          webName,
          "--platform",
          "linux/amd64",
          "--init",
          "--network",
          "bridge",
          "--shm-size",
          "1g",
          "--env",
          `FORCE_COLOR=${hostColorsEnabled() ? "1" : "0"}`,
          "--env",
          `ESM_WEB_NONCE=${nonce}`,
          ...networkEnv,
          image,
          "node",
          "script/src/esm/verify-webcontainer-browser.ts"
        ],
        project
      )
    } finally {
      hostSection(4, 4, "Export both reports and remove the test containers")
      for (const container of attempted) {
        const target = container === offlineName ? offlineDir : webDir
        copies[container] = await run(["cp", `${container}:/reports/.`, target], project)
      }
    }
    if (interrupted) throw new Error(`Host verification interrupted; reports: ${reports}`)
    assert.ok(
      Object.values(copies).every((code) => code === 0),
      `Could not export container diagnostics: ${reports}`
    )
    const offline = load(path.join(offlineDir, "report.json")),
      webcontainer = load(path.join(webDir, "report.json"))
    const errors: string[] = [],
      blocked: string[] = []
    try {
      if (offlineCode !== 0 && offlineCode !== 2)
        throw new Error(`Offline host verification exited with ${offlineCode}`)
      validateOffline(offline, offlineCode === 2)
      if (offlineCode === 2)
        blocked.push(
          "#817: incompatible USB catches its ABI error, then crashes or hangs under ordinary require without esm"
        )
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
    try {
      assert.ok(
        object(offline) && typeof offline.loaderSHA256 === "string",
        "Missing offline loader digest"
      )
      if (webCode === 2) {
        assert.ok(
          object(webcontainer) &&
            webcontainer.nonce === nonce &&
            webcontainer.loaderSHA256 === offline.loaderSHA256 &&
            webcontainer.blocked === true &&
            webcontainer.passed === false,
          "Unsubstantiated WebContainer environment blocker"
        )
        blocked.push(
          "#917: " + hostFailureText(webcontainer.error ?? "WebContainer runtime unavailable")
        )
      } else {
        if (webCode !== 0) {
          const detail = object(webcontainer)
            ? ` during ${String(webcontainer.stage ?? "unknown stage")}:\n${hostFailureText(webcontainer.error ?? "No browser error was recorded")}`
            : "; browser report is missing"
          throw new Error(`Real WebContainer verification exited with ${webCode}${detail}`)
        }
        validateWebContainerBrowserReport(webcontainer, {
          nonce,
          loaderSHA256: offline.loaderSHA256
        })
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
    const summary = {
      passed: errors.length === 0 && blocked.length === 0,
      blocked: errors.length === 0 && blocked.length > 0,
      target: "linux/amd64",
      runner: { platform: os.platform(), arch: os.arch() },
      image,
      offline,
      webcontainer,
      errors,
      blockers: blocked
    }
    writeFileSync(output, JSON.stringify(summary, null, 2))
    if (errors.length) throw new Error(`${errors.join("; ")}. Reports: ${reports}`)
    if (blocked.length)
      throw new HostVerificationBlocked(`${blocked.join("; ")}. Reports: ${reports}`)
  } finally {
    try {
      for (const container of attempted)
        cleanup[container] = await run(["rm", "--force", container], project)
    } finally {
      process.removeListener("SIGINT", onInterrupt)
      process.removeListener("SIGTERM", onInterrupt)
      process.removeListener("exit", onExit)
      writeFileSync(
        path.join(reports, "docker.json"),
        JSON.stringify(
          {
            image,
            container: offlineName,
            webcontainer: webName,
            platform: "linux/amd64",
            exitCode: offlineCode,
            webcontainerExitCode: webCode,
            copies,
            cleanup,
            cleanupCode: Object.values(cleanup).every((code) => code === 0) ? 0 : 1
          },
          null,
          2
        )
      )
    }
  }
  if (Object.values(cleanup).some((code) => code !== 0))
    throw new Error(`Could not remove verification containers; reports: ${reports}`)
  console.log(
    `${hostLabel("green", "PASS")} offline hosts and real WebContainer verification\n\n${hostLabel("cyan", "REPORT")} ${output}\n`
  )
  return reports
}
