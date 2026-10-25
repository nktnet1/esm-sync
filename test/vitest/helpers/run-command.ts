import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
import execa from "execa"

export async function runNodeCommand(
  args: readonly string[],
  {
    cwd,
    timeout,
    env = process.env,
    expectedExitCode = 0
  }: {
    cwd: string
    timeout: number
    env?: NodeJS.ProcessEnv
    expectedExitCode?: number
  }
): Promise<{ stdout: string; stderr: string; diagnostic: string }> {
  const started = performance.now()
  const result = await execa(process.execPath, args, {
    cwd,
    env,
    timeout,
    stdin: "ignore",
    windowsHide: true,
    reject: false,
    stripFinalNewline: false
  })
  const diagnostic = [
    "Node command result:",
    `Command: ${[process.execPath, ...args].map((part) => JSON.stringify(part)).join(" ")}`,
    `cwd: ${cwd}`,
    `Runtime: Node ${process.versions.node} (${process.platform}/${process.arch})`,
    `Elapsed: ${Math.round(performance.now() - started)} ms; timeout: ${timeout} ms`,
    `Exit code: ${result.exitCode ?? "none"}; expected: ${expectedExitCode}`,
    `Signal: ${result.signal ?? "none"}; timed out: ${result.timedOut}`,
    ...(result instanceof Error
      ? [
          "shortMessage" in result && typeof result.shortMessage === "string"
            ? result.shortMessage
            : result.message
        ]
      : []),
    `stdout:\n${result.stdout || "[empty]"}`,
    `stderr:\n${result.stderr || "[empty]"}`
  ].join("\n")

  assert.ok(!result.timedOut && !result.signal && result.exitCode === expectedExitCode, diagnostic)
  return { stdout: result.stdout, stderr: result.stderr, diagnostic }
}
