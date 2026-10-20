import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

export interface NodeResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

export const nodeEnv = process.env.ESM_SYNC_NODE_ENV || "development"
export const testEnvironments = [`${nodeEnv}-test`, `${nodeEnv}-test-cached`]
export const testPath = fileURLToPath(new URL("../../", import.meta.url))

// Execute loader scenarios in native Node processes, never through Vite's transformer.
export function runNode(
  args: readonly string[],
  esmEnv: string,
  options: NodeJS.ProcessEnv = {},
  {
    timeout = 20_000,
    executable = process.execPath
  }: { timeout?: number; executable?: string } = {}
): Promise<NodeResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ESM_ENV: esmEnv,
      NODE_ENV: nodeEnv,
      NODE_OPTIONS: "--disable-warning=DEP0144",
      ...options
    }

    // A scenario without explicit options must not inherit a developer override.
    if (!Object.hasOwn(options, "ESM_OPTIONS")) {
      delete env.ESM_OPTIONS
    }

    // Vitest's worker markers do not belong in the tested application process.
    for (const key of Object.keys(env)) {
      if (key === "VITEST" || key.startsWith("VITEST_")) {
        delete env[key]
      }
    }

    const child = spawn(executable, args, {
      cwd: testPath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout
    })
    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (exitCode, signal) => {
      if (signal !== null) {
        reject(new Error(`Node CLI terminated with signal ${signal}: ${stderr.slice(-4_000)}`))
        return
      }

      resolve({ exitCode, stdout, stderr })
    })
  })
}
