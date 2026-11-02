import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"
import { describe, it, expect, vi } from "vitest"
import { capturedOutputEnv } from "./helpers/captured-env.ts"
import { runNode } from "./helpers/run-node.ts"
import { runNodeCommand } from "./helpers/run-command.ts"

const cwd = os.tmpdir()
const output =
  "process.stdout.write('captured stdout\\n'); process.stderr.write('captured stderr\\n');"

describe("Node command diagnostics", () => {
  it("preserves stdout and stderr on success", async () => {
    const result = await runNodeCommand(["-e", output], { cwd, timeout: 10_000 })
    expect(result.stdout, result.diagnostic).toBe("captured stdout\n")
    expect(result.stderr, result.diagnostic).toBe("captured stderr\n")
  })

  it("keeps parent presentation colours out of captured Node output", async () => {
    expect(capturedOutputEnv({ FORCE_COLOR: "1", CLICOLOR_FORCE: "1", PATH: "/bin" })).toEqual({
      PATH: "/bin"
    })
    expect(
      capturedOutputEnv({ FORCE_COLOR: "1" }, { FORCE_COLOR: "2", NO_COLOR: undefined })
    ).toMatchObject({ FORCE_COLOR: "2" })

    vi.stubEnv("FORCE_COLOR", "1")
    vi.stubEnv("CLICOLOR_FORCE", "1")
    try {
      const command = await runNodeCommand(["-e", "console.log(42)"], {
        cwd,
        timeout: 10_000,
        env: { ...process.env }
      })
      expect(command.stdout, command.diagnostic).toBe("42\n")
      expect(command.stderr, command.diagnostic).toBe("")

      const fixture = await runNode(["-e", "console.log(42)"], "production-test", {}, { cwd })
      expect(fixture.exitCode, fixture.stderr).toBe(0)
      expect(fixture.stdout).toBe("42\n")
      expect(fixture.stderr).toBe("")
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("permits explicit colour when a fixture tests ANSI behaviour", async () => {
    const result = await runNode(
      ["-e", "console.log(42)"],
      "production-test",
      { FORCE_COLOR: "1", NO_COLOR: undefined, NODE_DISABLE_COLORS: undefined },
      { cwd }
    )
    expect(result.exitCode, result.stderr).toBe(0)
    expect(stripVTControlCharacters(result.stdout)).toBe("42\n")
    expect(result.stdout).not.toBe("42\n")
  })

  it("reports nonzero exits with runtime, command, directory and both output streams", async () => {
    const result = runNodeCommand(["-e", output + "process.exitCode = 23"], {
      cwd,
      timeout: 10_000
    })
    await expect(result).rejects.toBeInstanceOf(Error)
    for (const detail of [
      JSON.stringify(process.execPath),
      `cwd: ${cwd}`,
      `Runtime: Node ${process.versions.node} (${process.platform}/${process.arch})`,
      "Elapsed:",
      "timeout: 10000 ms",
      "Exit code: 23; expected: 0",
      "timed out: false",
      "stdout:\ncaptured stdout\n",
      "stderr:\ncaptured stderr\n"
    ])
      await expect(result).rejects.toThrow(detail)
  })

  it("accepts an explicitly expected failure without hiding its output", async () => {
    const result = await runNodeCommand(["-e", output + "process.exitCode = 1"], {
      cwd,
      timeout: 10_000,
      expectedExitCode: 1
    })
    expect(result.stdout, result.diagnostic).toBe("captured stdout\n")
    expect(result.stderr, result.diagnostic).toBe("captured stderr\n")
  })

  it("reports spawn errors when the working directory is missing", async () => {
    const directory = path.join(cwd, `esm-sync-missing-command-${randomUUID()}`)
    const result = runNodeCommand(["-e", ""], { cwd: directory, timeout: 10_000 })
    await expect(result).rejects.toBeInstanceOf(Error)
    for (const detail of ["ENOENT", `cwd: ${directory}`, "stdout:\n[empty]", "stderr:\n[empty]"])
      await expect(result).rejects.toThrow(detail)
  })

  it("identifies a timeout even when the child writes nothing", async () => {
    const result = runNodeCommand(["-e", "setInterval(() => {}, 1_000)"], { cwd, timeout: 1_000 })
    await expect(result).rejects.toBeInstanceOf(Error)
    for (const detail of [
      "timeout: 1000 ms",
      "timed out: true",
      "stdout:\n[empty]",
      "stderr:\n[empty]"
    ])
      await expect(result).rejects.toThrow(detail)
  }, 15_000)
})
