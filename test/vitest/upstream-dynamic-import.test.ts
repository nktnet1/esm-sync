import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, it } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const require = createRequire(import.meta.url)
const loaderPath = path.resolve(testPath, "../esm.js")
const mochaCLI = require.resolve("mocha/bin/mocha")
const mocha = require.resolve("mocha")
const upstreamFiles = [
  ["src/Utility.js", "e6d8ae74678d6c2de9800d4eda059ebca126f4bae17113eb9762c2f19dca32d1"],
  ["test/Utility.js", "d99fff6a6ef56367724f7fa7dea13ced41dbfb276eea9e9c61aa8a8b3e7e36e6"]
] as const

it("preserves pinned bytes in an actual Git checkout with core.autocrlf=true", async ({
  expect
}) => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-crlf-")))
  const git = promisify(execFile)
  try {
    await writeFile(
      path.join(directory, ".gitattributes"),
      await readFile(new URL("../../.gitattributes", import.meta.url))
    )
    await writeFile(path.join(directory, "control.txt"), "control\n")
    for (const [name] of upstreamFiles) {
      const target = path.join(directory, "test/fixture/upstream-829", name)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(
        target,
        await readFile(new URL(`../fixture/upstream-829/${name}`, import.meta.url))
      )
    }
    const cwd = { cwd: directory }
    await git("git", ["init", "--quiet"], cwd)
    await git("git", ["config", "core.autocrlf", "true"], cwd)
    await git("git", ["config", "core.eol", "crlf"], cwd)
    await git("git", ["add", "."], cwd)
    await rm(path.join(directory, "test"), { recursive: true })
    await rm(path.join(directory, "control.txt"))
    await git("git", ["checkout-index", "--all", "--force"], cwd)
    // Verify that checkout conversion is active, while the pinned files stay LF.
    expect(await readFile(path.join(directory, "control.txt"), "utf8")).toBe("control\r\n")
    for (const [name, checksum] of upstreamFiles) {
      const bytes = await readFile(path.join(directory, "test/fixture/upstream-829", name))
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(checksum)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

for (const esmEnv of testEnvironments) {
  describe.concurrent(`upstream #829 dynamic imports (${esmEnv})`, () => {
    for (const launch of ["cli", "synchronous"]) {
      it(`runs both original Dyo utility tests through Mocha ${launch}`, async ({ expect }) => {
        const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-dyo-829-")))
        try {
          const files: Record<string, string> = {
            "package.json": JSON.stringify({ private: true }),
            "setup.cjs": "globalThis.assert = require('node:assert')\n",
            "runner.cjs": `require('./setup.cjs')
const Mocha = require(${JSON.stringify(mocha)}), runner = new Mocha({reporter:'json'})
runner.addFile('./test/Utility.js'); runner.loadFiles(); runner.run(failures => { process.exitCode = failures ? 1 : 0 })\n`
          }
          for (const [name, checksum] of upstreamFiles) {
            const source = await readFile(
              new URL(`../fixture/upstream-829/${name}`, import.meta.url),
              "utf8"
            )
            expect(createHash("sha256").update(source).digest("hex")).toBe(checksum)
            files[name!] = source
          }
          for (const [name, source] of Object.entries(files)) {
            const filename = path.join(directory, name)
            await mkdir(path.dirname(filename), { recursive: true })
            await writeFile(filename, source)
          }
          const args =
            launch === "cli"
              ? [mochaCLI, "--require", "./setup.cjs", "--reporter", "json", "test/Utility.js"]
              : ["runner.cjs"]
          const env = { NODE_OPTIONS: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON" }
          const native = await runNode(args, esmEnv, env, { cwd: directory })
          expect(native.exitCode, native.stderr || native.stdout).toBe(0)
          expect(JSON.parse(native.stdout).stats.passes).toBe(2)
          for (const cache of [false, path.join(directory, "cache")]) {
            for (let attempt = 0; attempt < (cache === false ? 1 : 2); attempt++) {
              const result = await runNode(
                ["-r", loaderPath, ...args],
                esmEnv,
                { ...env, ESM_OPTIONS: JSON.stringify({ mode: "auto", cjs: true, cache }) },
                { cwd: directory }
              )
              expect(result.exitCode, result.stderr || result.stdout).toBe(0)
              expect(result.stderr).toBe("")
              const report = JSON.parse(result.stdout) as {
                stats: { passes: number; failures: number }
              }
              expect(report.stats.passes).toBe(2)
              expect(report.stats.failures).toBe(0)
            }
          }
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      })
    }
  })
}
