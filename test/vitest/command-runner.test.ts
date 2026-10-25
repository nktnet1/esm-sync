import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { describe, it } from "vitest"
import { runNodeCommand } from "./helpers/run-command.ts"

const cwd = os.tmpdir()
const output =
  "process.stdout.write('captured stdout\\n'); process.stderr.write('captured stderr\\n');"

describe("Node command diagnostics", () => {
  it("preserves stdout and stderr on success", async () => {
    const result = await runNodeCommand(["-e", output], { cwd, timeout: 10_000 })
    assert.equal(result.stdout, "captured stdout\n", result.diagnostic)
    assert.equal(result.stderr, "captured stderr\n", result.diagnostic)
  })

  it("reports nonzero exits with runtime, command, directory and both output streams", async () => {
    await assert.rejects(
      runNodeCommand(["-e", output + "process.exitCode = 23"], { cwd, timeout: 10_000 }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
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
          assert.ok(error.message.includes(detail), error.message)
        return true
      }
    )
  })

  it("accepts an explicitly expected failure without hiding its output", async () => {
    const result = await runNodeCommand(["-e", output + "process.exitCode = 1"], {
      cwd,
      timeout: 10_000,
      expectedExitCode: 1
    })
    assert.equal(result.stdout, "captured stdout\n", result.diagnostic)
    assert.equal(result.stderr, "captured stderr\n", result.diagnostic)
  })

  it("reports spawn errors when the working directory is missing", async () => {
    const directory = path.join(cwd, `esm-sync-missing-command-${randomUUID()}`)
    await assert.rejects(
      runNodeCommand(["-e", ""], { cwd: directory, timeout: 10_000 }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        for (const detail of [
          "ENOENT",
          `cwd: ${directory}`,
          "stdout:\n[empty]",
          "stderr:\n[empty]"
        ])
          assert.ok(error.message.includes(detail), error.message)
        return true
      }
    )
  })

  it("identifies a timeout even when the child writes nothing", async () => {
    await assert.rejects(
      runNodeCommand(["-e", "setInterval(() => {}, 1_000)"], { cwd, timeout: 1_000 }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        for (const detail of [
          "timeout: 1000 ms",
          "timed out: true",
          "stdout:\n[empty]",
          "stderr:\n[empty]"
        ])
          assert.ok(error.message.includes(detail), error.message)
        return true
      }
    )
  }, 15_000)
})
