import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { describe, expect, it } from "vitest"
import {
  createWebContainerHarness,
  validateWebContainerBrowserReport,
  webContainerFileTree
} from "../../script/src/esm/verify-webcontainer-browser.ts"
import { webContainerBrowserPage } from "../../script/src/esm/webcontainer-browser-page.ts"
import { successfulWebContainerReport } from "./helpers/webcontainer-report.ts"

const nonce = "browser-unit-nonce",
  hash = "b".repeat(64)
describe("real WebContainer evidence validation", () => {
  it("accepts complete real-host, cache and application-use evidence", () =>
    expect(() =>
      validateWebContainerBrowserReport(successfulWebContainerReport(nonce, hash), {
        nonce,
        loaderSHA256: hash
      })
    ).not.toThrow())
  for (const fault of [
    "nonce",
    "hash",
    "not-booted",
    "not-isolated",
    "wrong-scope",
    "wrong-worker-hash",
    "emulation",
    "duplicate-phase",
    "missing-probe",
    "no-consumer",
    "globals-corrupted",
    "worker-failed"
  ] as const) {
    it(`rejects ${fault} instead of marking 917 resolved`, () => {
      const report = successfulWebContainerReport(nonce, hash)
      if (fault === "nonce") report.nonce = "stale"
      if (fault === "hash") report.loaderSHA256 = "c".repeat(64)
      if (fault === "not-booted") report.booted = false
      if (fault === "not-isolated") report.crossOriginIsolated = false
      if (fault === "wrong-scope") report.scope = "shared-realm-vm-regression"
      if (fault === "wrong-worker-hash") report.worker.loaderSHA256 = "c".repeat(64)
      if (fault === "emulation") {
        const probe = JSON.parse(report.artifacts["disabled.json"]!) as Record<string, unknown>
        probe.emulate = true
        report.artifacts["disabled.json"] = JSON.stringify(probe)
      }
      if (fault === "duplicate-phase") report.worker.samples[1]!.phase = "disabled"
      if (fault === "missing-probe") delete report.artifacts["warm.json"]
      if (fault === "no-consumer")
        for (const sample of report.worker.samples)
          for (const evidence of sample.applicationEvidence) evidence.factories = 0
      if (fault === "globals-corrupted")
        report.worker.samples[0]!.applicationEvidence[0]!.globalsPreserved = false
      if (fault === "worker-failed") report.worker.passed = false
      expect(() =>
        validateWebContainerBrowserReport(report, { nonce, loaderSHA256: hash })
      ).toThrow()
    })
  }
})

describe("local WebContainer harness", () => {
  it("serves isolation headers and only explicit assets, authenticates results and rejects duplicates", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-wc-server-")))
    await writeFile(path.join(directory, "index.js"), "export const unit = true")
    const events: Record<string, unknown>[] = []
    const harness = await createWebContainerHarness({
      nonce,
      sdk: directory,
      files: { value: { file: { contents: "unit fixture" } } },
      onEvent: (value) => events.push(value)
    })
    try {
      const page = await fetch(harness.url)
      expect(page.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin")
      expect(page.headers.get("Cross-Origin-Embedder-Policy")).toBe("credentialless")
      expect(page.headers.get("Cache-Control")).toBe("no-store")
      expect(await (await fetch(harness.url + "sdk/index.js")).text()).toContain("unit = true")
      expect((await fetch(harness.url + "sdk/%2e%2e/package.json")).status).toBe(404)
      expect((await fetch(harness.url + "anything-else")).status).toBe(404)
      expect(await (await fetch(harness.url + "files.json")).json()).toEqual({
        value: { file: { contents: "unit fixture" } }
      })
      const post = (route: string, value: unknown) =>
        fetch(harness.url + route, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value)
        })
      expect((await post("result", { nonce: "wrong", passed: true })).status).toBe(403)
      expect((await post("event", { nonce, type: "stage", message: "unit" })).status).toBe(204)
      expect(events).toHaveLength(1)
      expect((await post("result", { nonce, passed: false })).status).toBe(204)
      expect(await harness.result).toEqual({ nonce, passed: false })
      expect((await post("result", { nonce, passed: true })).status).toBe(409)
    } finally {
      await harness.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it("does not follow symlinks or silently corrupt binary data while mounting files", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-wc-tree-")))
    try {
      await mkdir(path.join(directory, "source"))
      await writeFile(path.join(directory, "source/value.js"), "export const answer = 42")
      expect(webContainerFileTree(directory)).toEqual({
        source: { directory: { "value.js": { file: { contents: "export const answer = 42" } } } }
      })
      await writeFile(path.join(directory, "binary"), Buffer.from([255]))
      expect(() => webContainerFileTree(directory)).toThrow(/UTF-8/)
      await rm(path.join(directory, "binary"))
      await symlink(path.join(directory, "source/value.js"), path.join(directory, "link"))
      expect(() => webContainerFileTree(directory)).toThrow(/symlink/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("browser-side automation with an in-memory SDK stub", () => {
  for (const outcome of ["success", "boot-failure", "runtime-error", "worker-failure"] as const) {
    it(`handles ${outcome} without any external service`, async () => {
      const report = successfulWebContainerReport(nonce, hash)
      const posted: Record<string, unknown>[] = []
      let mounts = 0,
        starts = 0,
        teardowns = 0
      const fixtureFetch = async (input: string, init?: RequestInit): Promise<Response> => {
        if (input === "/files.json")
          return Response.json({ unit: { file: { contents: "unit only" } } })
        const value = JSON.parse(String(init?.body)) as Record<string, unknown>
        posted.push(value)
        return new Response(null, { status: 204 })
      }
      const sdk = {
        WebContainer: {
          boot: async (options: unknown) => {
            expect(options).toMatchObject({ coep: "credentialless" })
            if (outcome === "boot-failure") throw new Error("unit boot failure")
            return {
              workdir: "/home/unit",
              on: (_name: string, listener: (value: { message: string }) => void) => {
                if (outcome === "runtime-error") listener({ message: "unit runtime error" })
              },
              mount: async () => {
                mounts++
              },
              spawn: async (command: string, args: string[]) => {
                starts++
                expect(command).toBe("node")
                expect(args).toEqual(["script/src/esm/verify-webcontainer.js", "application"])
                return {
                  exit: Promise.resolve(outcome === "worker-failure" ? 1 : 0),
                  output: new ReadableStream<string>({
                    start(controller) {
                      controller.enqueue("unit output")
                      controller.close()
                    }
                  })
                }
              },
              fs: {
                readdir: async (directory: string) =>
                  directory === ".cache/host-verification"
                    ? ["webcontainer-unit"]
                    : Object.keys(report.artifacts),
                readFile: async (file: string) => report.artifacts[path.basename(file)]
              },
              teardown: () => {
                teardowns++
              }
            }
          }
        }
      }
      const script = webContainerBrowserPage(nonce).replace(
        "await import('/sdk/dist/index.js')",
        "await unitSdk()"
      )
      const completion: unknown = vm.runInNewContext("(async()=>{" + script + "})()", {
        self: { crossOriginIsolated: true },
        navigator: { userAgent: "unit browser" },
        fetch: fixtureFetch,
        WritableStream,
        unitSdk: async () => sdk
      })
      await completion
      const result = posted.find((value) => "passed" in value)
      expect(result).toBeDefined()
      expect(result!.passed).toBe(outcome === "success")
      expect(result!.blocked).toBe(outcome === "boot-failure")
      expect(starts).toBe(outcome === "boot-failure" ? 0 : 1)
      expect(mounts).toBe(starts)
      expect(teardowns).toBe(starts)
    })
  }
})
