import assert from "node:assert/strict"
import { cpSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { styleText } from "node:util"
import { hostRuntimeCache } from "./host-runtimes.ts"
import { main } from "./verify-hosts.ts"

async function run(): Promise<void> {
  assert.ok(
    process.platform === "linux" && process.arch === "x64",
    "Use the Linux/amd64 host image"
  )
  mkdirSync("/reports", { recursive: true })
  cpSync(path.join(hostRuntimeCache, "inputs.json"), "/reports/inputs.json")
  await main(["--skip-build", "--xvfb", "--quiet-fontconfig"], { reportDirectory: "/reports" })
  // Preserve an explicit nonzero status even if a future entry-point change
  // accidentally stops propagating the verifier's process.exitCode.
  const report = JSON.parse(readFileSync("/reports/report.json", "utf8")) as { passed?: boolean }
  if (report.passed !== true) process.exitCode = 1
}

run().catch((error: unknown) => {
  console.error(`${styleText("red", "FAIL")} ${String(error)}`)
  process.exitCode = 1
})
