import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createServer, type RequestListener } from "node:http"
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import {
  downloadHostRuntime,
  hostRuntimes,
  type HostRuntime
} from "../../script/src/esm/host-runtimes.ts"
import { verifyHostsDocker, type DockerRunner } from "../../script/src/esm/verify-hosts-docker.ts"
import { prepareProject, runCommand } from "../../script/src/esm/verify-hosts-container.ts"

async function withDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-docker ü -")))
  try {
    await action(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function withServer(
  listener: RequestListener,
  action: (url: string) => Promise<void>
): Promise<void> {
  const server = createServer(listener)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test HTTP port")
  try {
    await action(`http://127.0.0.1:${address.port}/runtime`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
}

const payload = Buffer.from("historical-runtime-test-bytes")
function input(url: string): HostRuntime {
  return {
    issue: 867,
    file: "runtime.zip",
    url,
    sha256: createHash("sha256").update(payload).digest("hex"),
    maxBytes: 1024
  }
}

describe("self-contained desktop host verification", () => {
  it("downloads verified bytes, reuses the cache without fetching, and replaces a corrupt cached file", async () => {
    let requests = 0
    await withDirectory(async (directory) =>
      withServer(
        (_request, response) => {
          requests++
          response.end(payload)
        },
        async (url) => {
          const spec = input(url)
          expect(await downloadHostRuntime(spec, directory)).toBe("downloaded")
          expect(await downloadHostRuntime(spec, directory)).toBe("cached")
          expect(requests).toBe(1)
          await writeFile(path.join(directory, spec.file), "corrupt-cache")
          expect(await downloadHostRuntime(spec, directory)).toBe("downloaded")
          expect(requests).toBe(2)
          expect(await readFile(path.join(directory, spec.file))).toEqual(payload)
          expect(await readdir(directory)).toEqual([spec.file])
        }
      )
    )
  })

  it("retries transient HTTP failures before publishing the verified archive", async () => {
    let requests = 0
    await withDirectory(async (directory) =>
      withServer(
        (_request, response) => {
          requests++
          response.statusCode = requests < 3 ? 503 : 200
          response.end(requests < 3 ? "temporarily unavailable" : payload)
        },
        async (url) => {
          expect(await downloadHostRuntime(input(url), directory)).toBe("downloaded")
          expect(requests).toBe(3)
          expect(await readdir(directory)).toEqual(["runtime.zip"])
        }
      )
    )
  })

  for (const failure of ["checksum", "declared-size", "streamed-size"] as const) {
    it(`rejects ${failure} failures and removes all partial downloads`, async () => {
      let requests = 0
      await withDirectory(async (directory) =>
        withServer(
          (_request, response) => {
            requests++
            if (failure === "streamed-size") response.write(payload)
            response.end(payload)
          },
          async (url) => {
            const spec = {
              ...input(url),
              ...(failure === "checksum" ? { sha256: "0".repeat(64) } : { maxBytes: 1 })
            }
            await expect(downloadHostRuntime(spec, directory)).rejects.toThrow(
              failure === "checksum" ? /checksum mismatch/ : /size limit/
            )
            expect(requests).toBe(3)
            expect(await readdir(directory)).toEqual([])
          }
        )
      )
    })
  }

  it("rejects download filenames outside the ignored cache before making a request", async () => {
    await withDirectory(async (directory) => {
      for (const file of ["../escape.zip", "..", "C:\\escape.zip", "/absolute.zip"]) {
        await expect(
          downloadHostRuntime({ ...input("https://example.invalid"), file }, directory)
        ).rejects.toThrow()
      }
      expect(await readdir(directory)).toEqual([])
    })
  })

  it("stages the checked-in original sources and real get-port without archives or downloads", async () => {
    await withDirectory(async (directory) => {
      const fixture = path.resolve("test/fixture/hosts")
      for (const issue of [867, 915, 691] as const) {
        const project = await prepareProject(issue, directory)
        const names =
          issue === 867
            ? ["index.html", "renderer.js", "package.json"]
            : issue === 691
              ? ["index.html", "syntax.js", "runtime.js", "healthy.js", "package.json"]
              : ["src/extension.ts", "src/main.ts", "package.json"]
        for (const file of names)
          expect(await readFile(path.join(project, file))).toEqual(
            await readFile(path.join(fixture, `issue-${issue}`, file))
          )
        if (issue === 915) {
          expect(await readFile(path.join(project, "node_modules/get-port/index.js"))).toEqual(
            await readFile(path.join(fixture, "get-port-6.1.2/index.js"))
          )
          expect(await readFile(path.join(project, "out/main.js"), "utf8")).toContain(
            'require("get-port")'
          )
        }
      }
      // Anchor the executed files to the supplied historical archives. Biome
      // excludes fixtures so their original bytes are not reformatted.
      const hashes = {
        "issue-867/index.html": "399d2f4f0436675e08ac52c237a7fb7f43ed5426d471e0835b864b3df0f98ccb",
        "issue-867/renderer.js": "c57f8b10e83a241f2d3813c7f47564b530546f8327e28bfc3b81c1aa12c58942",
        "issue-915/src/extension.ts":
          "d779a3e96980f5201037290c02ac41da84c1c94b705527dab06be785dfb997c8",
        "issue-915/src/main.ts": "ccb41dda674841d960ec0deba918c9454ddefa182d9b38b0754903c8876d48ca",
        "get-port-6.1.2/index.js":
          "295d613c8f55e91eb1ceefdbe7c8b09d79d26d40b610709f2a3022311a049eed"
      }
      for (const [file, hash] of Object.entries(hashes))
        expect(
          createHash("sha256")
            .update(await readFile(path.join(fixture, file)))
            .digest("hex")
        ).toBe(hash)
    })
  })

  it("ignores downloaded runtimes and Docker reports and uses the repository's pinned package manager", async () => {
    const paths = [
      ...hostRuntimes.map((spec) => `.cache/host-runtimes/${spec.file}`),
      ".cache/host-runtimes/inputs.json",
      "src/vendor/acorn/acorn/src/state.js",
      ".cache/host-verification/run-example/reports/report.json"
    ]
    const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
      input: paths.join("\n") + "\n",
      encoding: "utf8"
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim().split("\n")).toEqual(paths)
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      packageManager: string
    }
    expect(await readFile("script/docker/hosts.Dockerfile", "utf8")).toContain(
      manifest.packageManager
    )
  })

  it.skipIf(process.platform !== "linux" || process.arch !== "x64")(
    "exports a failed container report when the image's runtime inputs are missing",
    async () => {
      await withDirectory(async (directory) => {
        const reports = path.join(directory, "reports")
        const image = path.join(directory, "incomplete-image")
        const scripts = path.join(image, "script/src/esm")
        const cache = path.join(image, ".cache/host-runtimes")
        await mkdir(scripts, { recursive: true })
        await mkdir(cache, { recursive: true })
        await mkdir(path.join(image, "dist/esm"), { recursive: true })
        for (const file of [
          "verify-hosts-container.ts",
          "host-probes.ts",
          "host-runtimes.ts",
          "package.json"
        ])
          await cp(path.resolve("script/src/esm", file), path.join(scripts, file))
        const inputs = JSON.stringify({ runtimes: hostRuntimes })
        await writeFile(path.join(cache, "inputs.json"), inputs)
        await writeFile(path.join(image, "dist/esm/loader.js"), "// Host is never launched.\n")
        const verifier = pathToFileURL(path.join(scripts, "verify-hosts-container.ts")).href
        const source = `import {verifyHostsContainer} from ${JSON.stringify(verifier)}
await verifyHostsContainer(process.argv[1])`
        // Run the actual container report writer against an incomplete image tree.
        // Missing runtimes must fail before any download or GUI launch is possible.
        const result = await runCommand(
          process.execPath,
          ["--input-type=module", "-e", source, reports],
          process.cwd(),
          { ...process.env, DISPLAY: ":unused", TMPDIR: directory, TMP: directory, TEMP: directory }
        )
        expect(result.code).not.toBe(0)
        const report = JSON.parse(await readFile(path.join(reports, "report.json"), "utf8")) as {
          passed: boolean
          samples: { passed: boolean; error: string }[]
        }
        expect(report.passed).toBe(false)
        expect(report.samples).toHaveLength(3)
        expect(report.samples.every((sample) => sample.passed === false)).toBe(true)
        expect(report.samples.every((sample) => /missing runtime archive/.test(sample.error))).toBe(
          true
        )
        expect(await readFile(path.join(reports, "inputs.json"), "utf8")).toBe(inputs)
        const files = await readdir(reports)
        expect(files.sort()).toEqual(["inputs.json", "report.json"])
        expect(result.stdout).toContain(path.join(reports, "report.json"))
      })
    }
  )

  const image = "sha256:" + "a".repeat(64)
  const validReport = {
    passed: true,
    loaderSHA256: "b".repeat(64),
    samples: [867, 915, 691].flatMap((issue) =>
      ["disabled", "cold", "warm"].map((phase) => ({ issue, phase, passed: true }))
    )
  }

  for (const outcome of [
    "success",
    "build-failure",
    "run-failure",
    "missing-report",
    "failed-report",
    "duplicate-phase",
    "malformed-report",
    "copy-failure"
  ] as const) {
    it(`exports diagnostics and cleans only its own container for ${outcome}`, async () => {
      await withDirectory(async (directory) => {
        const events: string[][] = []
        let reports = ""
        const runner: DockerRunner = async (args, cwd) => {
          expect(await realpath(cwd)).toBe(directory)
          events.push(args)
          if (args[0] === "build") {
            if (outcome === "build-failure") return 1
            const index = args.indexOf("--iidfile")
            await writeFile(args[index + 1]!, image + "\n")
          } else if (args[0] === "run") {
            return outcome === "run-failure" ? 1 : 0
          } else if (args[0] === "cp") {
            reports = args[2]!
            if (outcome === "copy-failure") return 1
            await writeFile(path.join(reports, "867-disabled.log"), "native-host-diagnostic")
            if (outcome !== "missing-report") {
              const report =
                outcome === "failed-report"
                  ? { ...validReport, passed: false }
                  : outcome === "duplicate-phase"
                    ? {
                        ...validReport,
                        samples: validReport.samples.map((sample) => ({ ...sample, phase: "cold" }))
                      }
                    : validReport
              await writeFile(
                path.join(reports, "report.json"),
                outcome === "malformed-report" ? "invalid JSON" : JSON.stringify(report)
              )
            }
          }
          return 0
        }
        if (outcome === "success") expect(await verifyHostsDocker(directory, runner)).toBe(reports)
        else await expect(verifyHostsDocker(directory, runner)).rejects.toThrow()
        const run = events.find((args) => args[0] === "run")
        if (outcome === "build-failure") {
          expect(run).toBeUndefined()
          expect(events.some((args) => args[0] === "rm")).toBe(false)
        } else {
          expect(run).toBeDefined()
          expect(run!.at(-1)).toBe(image)
          expect(run).toContain("--init")
          expect(run!.slice(run!.indexOf("--network"), run!.indexOf("--network") + 2)).toEqual([
            "--network",
            "none"
          ])
          expect(run).not.toContain("--volume")
          expect(run).not.toContain("--mount")
          const name = run![run!.indexOf("--name") + 1]!
          expect(events.find((args) => args[0] === "cp")?.[1]).toBe(`${name}:/reports/.`)
          expect(events.at(-1)).toEqual(["rm", "--force", name])
          if (outcome !== "copy-failure")
            expect(await readFile(path.join(reports, "867-disabled.log"), "utf8")).toBe(
              "native-host-diagnostic"
            )
          expect(
            JSON.parse(await readFile(path.join(reports, "docker.json"), "utf8"))
          ).toMatchObject({ image, platform: "linux/amd64", cleanupCode: 0 })
        }
      })
    })
  }
})
