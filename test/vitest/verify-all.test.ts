import { execFile } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { describe, it } from "vitest"
import {
  runMatrix,
  runSteps,
  validateWorkerReport,
  workerSteps
} from "../../script/src/esm/verify-all.ts"

type Execute = Parameters<typeof runMatrix>[3]
const root = fileURLToPath(new URL("../..", import.meta.url))
const image = `sha256:${"a".repeat(64)}`

async function withDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-verify-all-")))
  try {
    await action(directory)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

function report(major: number, nonce: string, passed = true) {
  return {
    nonce,
    nodeMajor: major,
    node: `v${major}.99.0`,
    platform: "linux",
    arch: "x64",
    passed,
    results: workerSteps(major, "/reports").map((step, index) => ({
      id: step.id,
      label: step.label,
      status: !passed && index === 0 ? "failed" : "passed",
      exitCode: !passed && index === 0 ? 1 : 0,
      durationMs: 1
    }))
  }
}

describe("complete verification driver", () => {
  for (const major of [22, 24, 26]) {
    it(`runs all projects, conformance cases and package formats on Node ${major}`, ({
      expect
    }) => {
      const steps = workerSteps(major, "/reports")
      for (const mode of ["development", "production"]) {
        const build = `${mode}-build`
        const tests = steps.find((step) => step.id === `${mode}-tests`)!
        expect(tests.args).toEqual([mode === "production" ? "test:run:prod" : "test:run"])
        expect(tests.dependencies).toEqual([build])
        expect(tests.env?.ESM_ENV).toBe(`${mode}-test`)
        expect(steps.find((step) => step.id === `${mode}-conformance`)!.args).toEqual([
          "test:conformance:run",
          "--reporter",
          "dot",
          "--report",
          `/reports/${mode}-test262.json`
        ])
        expect(steps.find((step) => step.id === `${mode}-packed`)!.args).toEqual([
          "test:packed",
          "--format=both"
        ])
      }
      expect(steps.find((step) => step.id === "release-packed")!.dependencies).toEqual([
        "release-build"
      ])
      for (const id of ["startup", "startup-await", "await-benchmark"])
        expect(steps.find((step) => step.id === id)!.dependencies).toEqual(["release-build"])
      for (const id of ["lint", "types", "unused", "registry", "audit-production", "audit-all"])
        expect(steps.some((step) => step.id === id)).toBe(major === 24)
      const commands = steps.flatMap((step) => step.args).join(" ")
      expect(commands).not.toMatch(
        /--(?:suite|project|filter|limit|testNamePattern|passWithNoTests|allow-fail)/
      )
    })
  }

  it("blocks checks of a failed build, continues independent checks and saves every result", async ({
    expect
  }) => {
    await withDirectory(async (directory) => {
      const called: string[] = []
      const steps = workerSteps(24, directory)
      const results = await runSteps(steps, directory, async (step) => {
        called.push(step.id)
        return step.id === "development-build" ? 9 : 0
      })
      expect(results.find((entry) => entry.id === "development-build")?.exitCode).toBe(9)
      for (const id of ["development-tests", "development-conformance", "development-packed"]) {
        expect(called).not.toContain(id)
        expect(results.find((entry) => entry.id === id)?.status).toBe("blocked")
      }
      expect(called).toContain("production-tests")
      expect(called).toContain("registry")
      expect(JSON.parse(await readFile(path.join(directory, "steps.json"), "utf8"))).toEqual(
        results
      )
      const final = steps.at(-1)!
      const blocked = await runSteps(
        [{ ...final, dependencies: ["missing-build"] }],
        directory,
        async () => {
          throw new Error("A blocked command must not execute")
        }
      )
      expect(JSON.parse(await readFile(path.join(directory, "steps.json"), "utf8"))).toEqual(
        blocked
      )
    })
  })

  it("records command launch failures without losing subsequent results", async ({ expect }) => {
    await withDirectory(async (directory) => {
      const steps = workerSteps(24, directory).filter((step) => ["lint", "types"].includes(step.id))
      const results = await runSteps(steps, directory, async (step) => {
        if (step.id === "lint") throw new Error("Tool executable missing")
        return 0
      })
      expect(results[0]).toMatchObject({
        status: "failed",
        exitCode: null,
        error: "Tool executable missing"
      })
      expect(results[1]?.status).toBe("passed")
    })
  })

  it("rejects stale, partial, wrong-runtime and contradictory success reports", ({ expect }) => {
    const valid = report(24, "current")
    expect(() => validateWorkerReport(valid, 24, "current", 0)).not.toThrow()
    expect(() => validateWorkerReport(report(24, "current", false), 24, "current", 1)).not.toThrow()
    for (const invalid of [
      { ...valid, nonce: "stale" },
      { ...valid, nodeMajor: 22 },
      { ...valid, node: "v22.99.0" },
      { ...valid, platform: "darwin" },
      { ...valid, arch: "arm64" },
      { ...valid, passed: false },
      { ...valid, results: valid.results.slice(1) },
      { ...valid, results: [...valid.results].reverse() },
      {
        ...valid,
        results: valid.results.map((entry, index) =>
          index ? entry : { ...entry, status: "blocked" }
        )
      },
      {
        ...valid,
        results: valid.results.map((entry, index) => (index ? entry : { ...entry, exitCode: 1 }))
      }
    ])
      expect(() => validateWorkerReport(invalid, 24, "current", 0)).toThrow()
    expect(() => validateWorkerReport(valid, 24, "current", 1)).toThrow()
  })

  for (const failure of [
    "none",
    "build",
    "run",
    "export",
    "report",
    "cleanup",
    "launch"
  ] as const) {
    it(`exports reports and removes containers after ${failure === "none" ? "a successful run" : `${failure} failure`}`, async ({
      expect
    }) => {
      await withDirectory(async (directory) => {
        const calls: { id: string; args: string[]; cleanup: boolean }[] = []
        let nonce = ""
        const execute: Execute = async (step, _log, cleanup = false) => {
          calls.push({ id: step.id, args: step.args, cleanup })
          if (failure === "launch" && step.id === "run")
            throw new Error("Docker run failed to launch")
          if (step.id === "build") await writeFile(path.join(directory, "image-id"), image)
          if (step.id === "run") nonce = step.args[step.args.indexOf("--nonce") + 1]!
          if (step.id === "export") {
            const value = report(24, failure === "report" ? "stale" : nonce, failure !== "run")
            await writeFile(path.join(directory, "summary.json"), JSON.stringify(value))
          }
          return failure === step.id ? 7 : 0
        }
        if (["export", "report", "cleanup", "launch"].includes(failure))
          await expect(runMatrix(24, directory, "12.15.0", execute)).rejects.toThrow()
        else
          expect(await runMatrix(24, directory, "12.15.0", execute)).toBe(
            failure === "none" ? 0 : 7
          )
        const ids = calls.map((call) => call.id)
        expect(ids).toEqual(
          failure === "build"
            ? ["build"]
            : failure === "launch"
              ? ["build", "run", "cleanup"]
              : ["build", "run", "export", "cleanup"]
        )
        if (failure !== "build") {
          const run = calls.find((call) => call.id === "run")!
          expect(run.args).toContain(image)
          expect(run.args.slice(0, 3)).toEqual(["run", "--platform", "linux/amd64"])
          expect(run.args).not.toContain("--rm")
          expect(run.args).not.toContain("--volume")
          const name = run.args[run.args.indexOf("--name") + 1]!
          expect(calls.at(-1)).toEqual({
            id: "cleanup",
            args: ["rm", "--force", name],
            cleanup: true
          })
          if (failure !== "launch")
            expect(calls.find((call) => call.id === "export")).toEqual({
              id: "export",
              args: ["cp", `${name}:/reports/.`, directory],
              cleanup: true
            })
        }
      })
    })
  }

  it("runs its standalone help without dependencies or Docker", async ({ expect }) => {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ["script/src/esm/verify-all.ts", "--help"],
      { cwd: root }
    )
    expect(stdout).toContain("pnpm verify:all")
    expect(stdout).toContain("macOS or Linux")
    expect(stderr).toBe("")
  })

  it.skipIf(process.platform === "win32")(
    "rejects an unsupported host runtime or unavailable Docker daemon",
    async ({ expect }) => {
      await withDirectory(async (directory) => {
        const docker = path.join(directory, "docker")
        await writeFile(docker, "#!/bin/sh\nprintf 'daemon unavailable\\n' >&2\nexit 17\n")
        await chmod(docker, 0o755)
        const reports = path.join(directory, "reports")
        await mkdir(reports)
        const child = promisify(execFile)(
          process.execPath,
          ["script/src/esm/verify-all.ts", "--reports", reports],
          { cwd: root, env: { ...process.env, PATH: directory } }
        )
        if (Number(process.versions.node.split(".")[0]) < 24) {
          await expect(child).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining("Node 24 or newer")
          })
          expect(await readdir(reports)).toEqual([])
          return
        }
        await expect(child).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining("running daemon are required")
        })
        const [run] = await readdir(reports)
        const summary = JSON.parse(
          await readFile(path.join(reports, run!, "summary.json"), "utf8")
        ) as { passed: boolean; results: unknown[] }
        expect(summary).toMatchObject({ passed: false, results: [] })
        expect(await readFile(path.join(reports, run!, "docker.log"), "utf8")).toContain(
          "daemon unavailable"
        )
      })
    }
  )

  for (const failure of [false, true]) {
    it.skipIf(process.platform === "win32")(
      `executes the worker CLI and reports ${failure ? "failed builds without running dependent suites" : "every successful command"}`,
      async ({ expect }) => {
        await withDirectory(async (directory) => {
          const pnpm = path.join(directory, "pnpm")
          await writeFile(
            pnpm,
            `#!/usr/bin/env node
const fs = require('node:fs')
fs.appendFileSync(process.env.VERIFY_COMMANDS_FILE, JSON.stringify(process.argv.slice(2)) + '\\n')
console.log('fixture package manager: ' + process.argv.slice(2).join(' '))
process.exitCode = process.env.VERIFY_FAIL_COMMAND === process.argv[2] ? 19 : 0
`
          )
          await chmod(pnpm, 0o755)
          const reports = path.join(directory, "reports")
          const commands = path.join(directory, "commands.jsonl")
          const env = {
            ...process.env,
            PATH: [directory, path.dirname(process.execPath), process.env.PATH].join(
              path.delimiter
            ),
            VERIFY_COMMANDS_FILE: commands,
            VERIFY_FAIL_COMMAND: failure ? "build" : ""
          }
          const child = promisify(execFile)(
            process.execPath,
            [
              "script/src/esm/verify-all.ts",
              "--worker",
              "--nonce",
              "worker-cli",
              "--reports",
              reports
            ],
            { cwd: root, env }
          )
          if (failure) await expect(child).rejects.toMatchObject({ code: 1 })
          else expect((await child).stderr).toBe("")
          const major = Number(process.versions.node.split(".")[0])
          const plan = workerSteps(major, reports)
          const summary = JSON.parse(
            await readFile(path.join(reports, "summary.json"), "utf8")
          ) as {
            passed: boolean
            nonce: string
            nodeMajor: number
            results: { id: string; status: string }[]
          }
          expect(summary).toMatchObject({ passed: !failure, nonce: "worker-cli", nodeMajor: major })
          expect(summary.results.map((result) => result.id)).toEqual(plan.map((step) => step.id))
          const executed: unknown[] = (await readFile(commands, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as unknown)
          const runnable = plan.filter(
            (step) => summary.results.find((result) => result.id === step.id)?.status !== "blocked"
          )
          expect(executed).toEqual(runnable.map((step) => step.args))
          expect(await readFile(path.join(reports, "fixtures.log"), "utf8")).toContain(
            "fixtures:prepare"
          )
          if (failure) {
            expect(
              summary.results.find((result) => result.id === "development-tests")?.status
            ).toBe("blocked")
            expect(summary.results.find((result) => result.id === "release-packed")?.status).toBe(
              "passed"
            )
          }
        })
      }
    )
  }
})
