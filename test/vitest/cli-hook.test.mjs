import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, it } from "vitest"

const testPath = fileURLToPath(new URL("../", import.meta.url))
const esmPaths = ["../", "../index.js", "../esm.js"]
const nodeEnv = process.env.ESM_SYNC_NODE_ENV || "development"
const testEnvironments = [`${nodeEnv}-test`, `${nodeEnv}-test-cached`]

// Exercise the real Node loader rather than Vitest/Vite's module transformer.
function runNode(args, esmEnv, options = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ESM_ENV: esmEnv,
      NODE_ENV: nodeEnv,
      NODE_OPTIONS: "--disable-warning=DEP0144",
      ...options
    }

    // The negative case must not inherit an ESM_OPTIONS override from Vitest.
    if (!Object.hasOwn(options, "ESM_OPTIONS")) {
      delete env.ESM_OPTIONS
    }

    // Do not leak Vitest's worker markers into the native child process.
    for (const key of Object.keys(env)) {
      if (key === "VITEST" || key.startsWith("VITEST_")) {
        delete env[key]
      }
    }

    const child = spawn(process.execPath, args, {
      cwd: testPath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000
    })
    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (exitCode, signal) => {
      if (signal !== null) {
        reject(new Error(`Node CLI terminated with signal ${signal}: ${stderr}`))
        return
      }

      resolve({ exitCode, stdout, stderr })
    })
  })
}

for (const esmEnv of testEnvironments) {
  describe(`CLI hook (${esmEnv})`, () => {
    for (const request of esmPaths) {
      it(`does not fail on unresolvable arguments with ${request}`, async () => {
        const { exitCode, stderr } = await runNode(
          ["./node_modules/cli-hook-pass", "UNRESOLVABLE_VALUE", request],
          esmEnv,
          { ESM_OPTIONS: "{cjs:true,mode:'auto'}" }
        )

        assert.equal(exitCode, 0, stderr)
        assert.equal(stderr, "")
      })

      it(`inspects JSON-encoded arguments with ${request}`, async () => {
        const { exitCode, stdout, stderr } = await runNode(
          ["./node_modules/cli-hook-pass", JSON.stringify({ r: request })],
          esmEnv,
          { ESM_OPTIONS: "{cjs:true,mode:'auto'}" }
        )

        assert.equal(exitCode, 0, stderr)
        assert.ok(stdout.includes("cli-hook:true"), stdout)
      })

      it(`rejects .mjs sideloading with ${request}`, async () => {
        const { exitCode, stderr } = await runNode(
          ["./node_modules/cli-hook-fail", request],
          esmEnv
        )

        assert.notEqual(exitCode, 0)
        assert.ok(stderr.includes("[ERR_REQUIRE_ESM]"), stderr)
      })
    }
  })
}
