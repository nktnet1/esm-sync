import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { verifyHostsDocker, type DockerRunner } from "../../script/src/esm/verify-hosts-docker.ts"
import { successfulWebContainerReport } from "./helpers/webcontainer-report.ts"

const image = "sha256:" + "a".repeat(64),
  hash = "b".repeat(64)
const offline = {
  passed: true,
  controlsPassed: true,
  loaderSHA256: hash,
  usb: ["disabled", "cold", "warm"].map((phase) => ({
    phase,
    status: "resolved",
    runs: ["require", "import"].flatMap((mode) =>
      ["mismatch", "compatible"].map((binary) => ({ mode, binary, passed: true }))
    )
  })),
  samples: [867, 915, 691, 817, 917].flatMap((issue) =>
    ["disabled", "cold", "warm"].map((phase) => ({
      issue,
      phase,
      passed: true,
      scope:
        issue === 817
          ? "minimal-native-addon"
          : issue === 691
            ? "reconstructed-renderer"
            : issue === 917
              ? "shared-realm-vm-regression"
              : "original-reproduction"
    }))
  )
}

describe("automatic offline hosts and online WebContainer Docker phases", () => {
  for (const outcome of [
    "success",
    "build-failure",
    "offline-failure",
    "browser-failure",
    "missing-offline",
    "missing-browser",
    "malformed-offline",
    "duplicate-phase",
    "missing-usb",
    "blocked-usb",
    "blocked-browser",
    "wrong-browser-hash",
    "wrong-browser-nonce",
    "emulated-browser",
    "unused-consumer",
    "copy-failure"
  ] as const) {
    it(`collects both scopes and cleans only owned containers for ${outcome}`, async () => {
      const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-docker-auto ü -")))
      const events: string[][] = []
      let nonce = "",
        reports = ""
      try {
        const runner: DockerRunner = async (args, cwd) => {
          expect(await realpath(cwd)).toBe(directory)
          events.push(args)
          if (args[0] === "build") {
            if (outcome === "build-failure") return 1
            await writeFile(args[args.indexOf("--iidfile") + 1]!, image + "\n")
          } else if (args[0] === "run") {
            const web = args.includes("script/src/esm/verify-webcontainer-browser.ts")
            if (web) {
              nonce = args
                .find((value) => value.startsWith("ESM_WEB_NONCE="))!
                .slice("ESM_WEB_NONCE=".length)
              return outcome === "browser-failure" ? 1 : outcome === "blocked-browser" ? 2 : 0
            }
            return outcome === "offline-failure" ? 1 : outcome === "blocked-usb" ? 2 : 0
          } else if (args[0] === "cp") {
            const target = args[2]!
            reports = path.dirname(target)
            if (outcome === "copy-failure") return 1
            await mkdir(target, { recursive: true })
            if (args[1]!.includes("-offline:")) {
              await writeFile(path.join(target, "867-disabled.log"), "offline evidence")
              if (outcome === "missing-offline") return 0
              let report: unknown = offline
              if (outcome === "duplicate-phase")
                report = {
                  ...offline,
                  samples: offline.samples.map((sample) => ({ ...sample, phase: "cold" }))
                }
              if (outcome === "missing-usb") report = { ...offline, usb: [] }
              if (outcome === "blocked-usb")
                report = {
                  ...offline,
                  passed: false,
                  blocked: true,
                  usb: offline.usb.map((item) => ({
                    ...item,
                    status: "blocked",
                    runs: item.runs.map((run) =>
                      run.mode === "require" && run.binary === "mismatch"
                        ? {
                            ...run,
                            passed: false,
                            code: null,
                            signal: "SIGSEGV",
                            report: {
                              rejections: ["NODE_MODULE_VERSION 64 requires NODE_MODULE_VERSION 70"]
                            }
                          }
                        : run
                    )
                  }))
                }
              await writeFile(
                path.join(target, "report.json"),
                outcome === "malformed-offline" ? "invalid JSON" : JSON.stringify(report)
              )
            } else {
              if (outcome === "missing-browser") return 0
              const report = successfulWebContainerReport(nonce, hash)
              if (outcome === "wrong-browser-hash") report.worker.loaderSHA256 = "c".repeat(64)
              if (outcome === "wrong-browser-nonce") report.nonce = "stale-browser-run"
              if (outcome === "emulated-browser") {
                const probe = JSON.parse(report.artifacts["disabled.json"]!) as Record<
                  string,
                  unknown
                >
                probe.emulate = true
                report.artifacts["disabled.json"] = JSON.stringify(probe)
              }
              if (outcome === "unused-consumer")
                for (const sample of report.worker.samples)
                  for (const entry of sample.applicationEvidence) entry.factories = 0
              const value =
                outcome === "blocked-browser"
                  ? {
                      ...report,
                      passed: false,
                      blocked: true,
                      booted: false,
                      error: "Runtime unavailable"
                    }
                  : outcome === "browser-failure"
                    ? { ...report, passed: false, blocked: false }
                    : report
              await writeFile(path.join(target, "report.json"), JSON.stringify(value))
            }
          }
          return 0
        }
        if (outcome === "success") expect(await verifyHostsDocker(directory, runner)).toBe(reports)
        else await expect(verifyHostsDocker(directory, runner)).rejects.toThrow()
        const runs = events.filter((args) => args[0] === "run")
        if (outcome === "build-failure") {
          expect(runs).toHaveLength(0)
          expect(events.some((args) => args[0] === "rm")).toBe(false)
        } else {
          expect(runs).toHaveLength(2)
          expect(
            runs[0]!.slice(runs[0]!.indexOf("--network"), runs[0]!.indexOf("--network") + 2)
          ).toEqual(["--network", "none"])
          expect(
            runs[1]!.slice(runs[1]!.indexOf("--network"), runs[1]!.indexOf("--network") + 2)
          ).toEqual(["--network", "bridge"])
          expect(runs[1]).toContain("script/src/esm/verify-webcontainer-browser.ts")
          for (const args of runs) {
            expect(args).toContain(image)
            expect(args).toContain("linux/amd64")
            expect(args).not.toContain("--mount")
            expect(args).not.toContain("--volume")
          }
          const names = runs.map((args) => args[args.indexOf("--name") + 1]!)
          expect(events.filter((args) => args[0] === "rm").map((args) => args[2])).toEqual(names)
          expect(events.filter((args) => args[0] === "cp").map((args) => args[1])).toEqual(
            names.map((name) => `${name}:/reports/.`)
          )
          const data = JSON.parse(
            await readFile(path.join(reports, "docker.json"), "utf8")
          ) as Record<string, unknown>
          expect(data).toMatchObject({ image, platform: "linux/amd64", cleanupCode: 0 })
          if (outcome === "success" || outcome === "blocked-usb") {
            const summary = JSON.parse(
              await readFile(path.join(reports, "report.json"), "utf8")
            ) as Record<string, unknown>
            expect(summary.passed).toBe(outcome === "success")
            expect(summary.blocked).toBe(outcome === "blocked-usb")
            expect(summary.target).toBe("linux/amd64")
            expect(summary.webcontainer).toMatchObject({ passed: true, booted: true })
          }
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
})
