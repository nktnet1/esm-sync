import { execFile } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify, stripVTControlCharacters } from "node:util"
import { describe, it } from "vitest"
import packageInfo from "../../package.json"
import {
  localVerificationSteps,
  runSteps,
  verificationChildEnv,
  verificationColorsEnabled
} from "../../script/src/esm/verify-all.ts"

const root = fileURLToPath(new URL("../..", import.meta.url))

async function withDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-verify-all-")))
  try {
    await action(directory)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

describe("complete verification driver", () => {
  it("runs existing package scripts on the current Node with one production suite", ({
    expect
  }) => {
    const steps = localVerificationSteps("/reports")
    expect(steps.map((step) => step.id)).toEqual([
      "fixtures",
      "lint",
      "types",
      "unused",
      "production-tests",
      "production-conformance",
      "release-build",
      "release-packed",
      "startup",
      "startup-await",
      "await-benchmark",
      "registry",
      "audit-all",
      "hosts"
    ])
    for (const step of steps) {
      expect(step.command).toBe("pnpm")
      expect(packageInfo.scripts).toHaveProperty(step.args[0]!)
    }
    expect(steps.find((step) => step.id === "production-tests")?.args).toEqual(["verify:prod"])
    expect(steps.find((step) => step.id === "production-tests")?.dependencies).toEqual(["fixtures"])
    expect(steps.find((step) => step.id === "types")?.dependencies).toEqual(["fixtures"])
    expect(steps.find((step) => step.id === "production-conformance")).toMatchObject({
      args: [
        "test:conformance:run",
        "--reporter",
        "dot",
        "--report",
        "/reports/production-test262.json"
      ],
      dependencies: ["production-tests"],
      env: { NODE_ENV: "production", ESM_ENV: "production-test" }
    })
    expect(steps.find((step) => step.id === "release-build")?.args).toEqual(["build:prod"])
    expect(steps.find((step) => step.id === "release-build")?.dependencies).toEqual([
      "production-conformance"
    ])
    expect(steps.find((step) => step.id === "release-packed")?.args).toEqual([
      "test:packed",
      "--format=both"
    ])
    expect(steps.find((step) => step.id === "hosts")).toMatchObject({
      args: ["verify:hosts:docker"],
      dependencies: ["release-packed"]
    })
    expect(steps.filter((step) => step.args[0] === "fixtures:prepare")).toHaveLength(1)
    expect(steps.filter((step) => step.args[0] === "verify:prod")).toHaveLength(1)
    expect(steps.filter((step) => step.args[0] === "test:conformance:run")).toHaveLength(1)
    expect(steps.filter((step) => step.args[0] === "test:packed")).toHaveLength(1)
    expect(steps.flatMap((step) => step.args).join(" ")).not.toMatch(
      /--(?:suite|project|filter|limit|testNamePattern|passWithNoTests|allow-fail)/
    )
  })

  it("uses terminal colours unless explicitly disabled", ({ expect }) => {
    expect(verificationColorsEnabled({}, false)).toBe(false)
    expect(verificationColorsEnabled({}, true)).toBe(true)
    expect(verificationColorsEnabled({ FORCE_COLOR: "1" }, false)).toBe(true)
    expect(verificationColorsEnabled({ FORCE_COLOR: "0" }, true)).toBe(false)
    expect(verificationColorsEnabled({ NO_COLOR: "1" }, true)).toBe(false)
    expect(verificationColorsEnabled({ NODE_DISABLE_COLORS: "1" }, true)).toBe(false)
    expect(verificationColorsEnabled({ TERM: "dumb" }, true)).toBe(false)
    expect(verificationColorsEnabled({ CLICOLOR: "0" }, true)).toBe(false)
    expect(verificationColorsEnabled({ CLICOLOR_FORCE: "1" }, false)).toBe(true)
    expect(verificationColorsEnabled({ CLICOLOR_FORCE: "0" }, true)).toBe(true)
    expect(verificationColorsEnabled({ FORCE_COLOR: "1", NO_COLOR: "1" }, false)).toBe(true)
  })

  it("preserves colour for piped child processes without forcing redirected logs", ({ expect }) => {
    expect(verificationChildEnv({ TERM: "xterm-256color" }, true).FORCE_COLOR).toBe("1")
    expect(verificationChildEnv({}, false).FORCE_COLOR).toBe("0")
    expect(verificationChildEnv({ FORCE_COLOR: "3" }, false).FORCE_COLOR).toBe("3")
    expect(verificationChildEnv({ FORCE_COLOR: "0" }, true).FORCE_COLOR).toBe("0")
    expect(verificationChildEnv({ NO_COLOR: "1" }, true)).toMatchObject({ NO_COLOR: "1" })
    expect(verificationChildEnv({ NO_COLOR: "1" }, true).FORCE_COLOR).toBeUndefined()
    expect(verificationChildEnv({ NODE_DISABLE_COLORS: "1" }, true).FORCE_COLOR).toBeUndefined()
    expect(verificationChildEnv({ NO_COLOR: "1", FORCE_COLOR: "1" }, false)).toEqual({
      FORCE_COLOR: "1"
    })
    expect(verificationChildEnv({ NO_COLOR: "1", FORCE_COLOR: "0" }, true)).toEqual({
      NO_COLOR: "1"
    })
  })

  it("blocks release checks after a failed production test, but continues independent checks", async ({
    expect
  }) => {
    await withDirectory(async (directory) => {
      const called: string[] = []
      const steps = localVerificationSteps(directory)
      const results = await runSteps(steps, directory, async (step) => {
        called.push(step.id)
        return step.id === "production-tests" ? 19 : 0
      })
      expect(results.find((entry) => entry.id === "production-tests")?.exitCode).toBe(19)
      for (const id of [
        "production-conformance",
        "release-build",
        "release-packed",
        "startup",
        "registry",
        "hosts"
      ]) {
        expect(called).not.toContain(id)
        expect(results.find((entry) => entry.id === id)?.status).toBe("blocked")
      }
      expect(called).toContain("audit-all")
      expect(called).toContain("types")
      expect(JSON.parse(await readFile(path.join(directory, "steps.json"), "utf8"))).toEqual(
        results
      )
      const blocked = await runSteps(
        [{ ...steps.at(-1)!, dependencies: ["missing-build"] }],
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

  it("records command launch failures without losing subsequent checks", async ({ expect }) => {
    await withDirectory(async (directory) => {
      const steps = localVerificationSteps(directory).filter((step) =>
        ["lint", "audit-all"].includes(step.id)
      )
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

  it("prints CLI help without dependencies or Docker", async ({ expect }) => {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ["script/src/esm/verify-all.ts", "--help"],
      { cwd: root }
    )
    expect(stdout).toContain("pnpm verify:all")
    expect(stdout).toContain("Regular checks run natively")
    expect(stderr).toBe("")
  })

  for (const failing of [false, true]) {
    it.skipIf(process.platform === "win32")(
      `orchestrates package scripts and saves ${failing ? "failure" : "success"} reports`,
      async ({ expect }) => {
        await withDirectory(async (directory) => {
          const pnpm = path.join(directory, "pnpm")
          await writeFile(
            pnpm,
            `#!/usr/bin/env node
const fs = require('node:fs')
fs.appendFileSync(process.env.VERIFY_COMMANDS_FILE, JSON.stringify({
  args: process.argv.slice(2), NODE_ENV: process.env.NODE_ENV, ESM_ENV: process.env.ESM_ENV,
  FORCE_COLOR: process.env.FORCE_COLOR
}) + '\\n')
console.log(require('node:util').styleText('magenta', 'MOCK') + ' mock pnpm: ' + process.argv.slice(2).join(' '))
process.exitCode = process.env.VERIFY_FAIL_SCRIPT === process.argv[2] ? 19 : 0
`
          )
          await chmod(pnpm, 0o755)
          const reports = path.join(directory, "reports")
          await mkdir(reports)
          const commands = path.join(directory, "commands.jsonl")
          const env = {
            ...process.env,
            PATH: [directory, path.dirname(process.execPath), process.env.PATH].join(
              path.delimiter
            ),
            VERIFY_COMMANDS_FILE: commands,
            VERIFY_FAIL_SCRIPT: failing ? "verify:prod" : "",
            FORCE_COLOR: failing ? "0" : "1",
            NO_COLOR: undefined,
            NODE_DISABLE_COLORS: undefined
          }
          const child = promisify(execFile)(
            process.execPath,
            ["script/src/esm/verify-all.ts", "--reports", reports],
            { cwd: root, env }
          )
          let output: string
          if (failing) {
            const error = (await child.catch((value: unknown) => value)) as {
              code: number
              stdout: string
            }
            expect(error.code).toBe(1)
            output = error.stdout
          } else {
            const completed = await child
            expect(completed.stderr).toBe("")
            output = completed.stdout
          }
          expect(output.includes("\u001b[")).toBe(!failing)
          expect(output).toContain("MOCK")
          expect(stripVTControlCharacters(output)).toContain(`NODE ${process.version}`)
          const [run] = await readdir(reports)
          const runDirectory = path.join(reports, run!)
          const plan = localVerificationSteps(runDirectory)
          const summary = JSON.parse(
            await readFile(path.join(runDirectory, "summary.json"), "utf8")
          ) as {
            passed: boolean
            nodeMajor: number
            node: string
            results: { id: string; status: string }[]
          }
          expect(summary.passed).toBe(!failing)
          expect(summary.nodeMajor).toBe(Number(process.versions.node.split(".")[0]))
          expect(summary.node).toBe(process.version)
          expect(summary.results.map((result) => result.id)).toEqual(plan.map((step) => step.id))
          const executed: Array<{
            args: string[]
            NODE_ENV?: string
            ESM_ENV?: string
            FORCE_COLOR?: string
          }> = (await readFile(commands, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as { args: string[] })
          expect(executed.every((entry) => entry.FORCE_COLOR === (failing ? "0" : "1"))).toBe(true)
          expect(executed.map((entry) => entry.args)).toEqual(
            plan
              .filter(
                (step) =>
                  summary.results.find((result) => result.id === step.id)?.status !== "blocked"
              )
              .map((step) => step.args)
          )
          if (failing) {
            expect(
              summary.results.find((result) => result.id === "production-conformance")?.status
            ).toBe("blocked")
            expect(summary.results.find((result) => result.id === "hosts")?.status).toBe("blocked")
            expect(executed.some((entry) => entry.args[0] === "audit:all")).toBe(true)
          } else {
            const conformance = executed.find((entry) => entry.args[0] === "test:conformance:run")!
            expect(conformance).toMatchObject({
              NODE_ENV: "production",
              ESM_ENV: "production-test"
            })
          }
          expect(await readFile(path.join(runDirectory, "production-tests.log"), "utf8")).toContain(
            "mock pnpm: verify:prod"
          )
        })
      }
    )
  }
})
