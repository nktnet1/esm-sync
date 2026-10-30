import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { electronProbe, vscodeProbe } from "../../script/src/esm/host-probes.ts"
import {
  prepareProject,
  hostLaunchArgs,
  runHostCase,
  runCommand,
  safeTarget,
  validateReport
} from "../../script/src/esm/verify-hosts.ts"
import { Script } from "node:vm"

const identity = {
  issue: 915,
  phase: "cold",
  nonce: "this-run",
  loader: "/private/staged/esm.js"
} as const
const success = {
  ...identity,
  passed: true,
  errors: [],
  version: "1.66.2",
  commandExecuted: true,
  ports: [13604]
}

describe("desktop host verification", () => {
  it("does not count successful activation or a successful exit as allocated-port evidence", () => {
    expect(() => validateReport(success, identity, 0)).not.toThrow()
    expect(() => validateReport(null, identity, 0)).toThrow()
    expect(() => validateReport({ ...success, ports: [] }, identity, 0)).toThrow(/port/)
    expect(() => validateReport(success, identity, 1)).toThrow(/unsuccessfully/)
    expect(() => validateReport({ ...success, ports: [0] }, identity, 0)).toThrow()
    expect(() => validateReport({ ...success, ports: [65536] }, identity, 0)).toThrow()
  })

  it("rejects stale results, wrong loaders, wrong hosts, and errors after successful output", () => {
    for (const override of [
      { nonce: "previous-run" },
      { loader: "/old/npm/esm.js" },
      { phase: "warm" },
      { version: "1.99.0" },
      { commandExecuted: false },
      { passed: false },
      { errors: ["ERR_REQUIRE_ESM"] }
    ])
      expect(() => validateReport({ ...success, ...override }, identity, 0)).toThrow()
  })

  it("requires a greeting from all four real Electron 8 page loads", () => {
    const expected = { ...identity, issue: 867 } as const
    const loads = Array.from({ length: 4 }, (_, index) => ({
      index,
      hello: 1,
      versions: { electron: "8.0.0" }
    }))
    const result = { ...expected, passed: true, errors: [], loads }
    expect(() => validateReport(result, expected, 0)).not.toThrow()
    expect(() => validateReport({ ...result, loads: loads.slice(1) }, expected, 0)).toThrow(
      /reloads/
    )
    expect(() =>
      validateReport(
        { ...result, loads: loads.map((load) => ({ ...load, hello: 0 })) },
        expected,
        0
      )
    ).toThrow()
    expect(() =>
      validateReport(
        { ...result, loads: loads.map((load) => ({ ...load, versions: { electron: "30.0.0" } })) },
        expected,
        0
      )
    ).toThrow()
  })

  it("rejects archive paths that could escape the private workspace", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-paths-")))
    try {
      expect(safeTarget(directory, "src/main.ts")).toBe(path.join(directory, "src/main.ts"))
      for (const filename of [
        "../escape",
        "/absolute",
        "C:/absolute",
        "dir/../../escape",
        "dir\\..\\escape"
      ]) {
        expect(() => safeTarget(directory, filename)).toThrow(/archive path/)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("runs a native child, retains failure output, and enforces the deadline", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "console.log('ready'); console.error('failed'); process.exitCode = 2"],
      process.cwd(),
      process.env
    )
    expect(result.code).toBe(2)
    expect(result.stdout.trim()).toBe("ready")
    expect(result.stderr).toContain("failed")
    await expect(
      runCommand(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        process.cwd(),
        process.env,
        500
      )
    ).rejects.toThrow(/timed out/)
    await expect(
      runCommand(
        path.join(process.cwd(), "nonexistent-host-binary"),
        [],
        process.cwd(),
        process.env
      )
    ).rejects.toThrow(/ENOENT/)
  })

  it("emits host probes that parse without TypeScript or modern module syntax", () => {
    expect(() => new Script(electronProbe)).not.toThrow()
    expect(() => new Script(vscodeProbe)).not.toThrow()
  })

  for (const issue of [867, 915] as const) {
    it(`passes Linux startup flags and private paths intact to host #${issue}`, async () => {
      const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-args ü -")))
      try {
        const project = path.join(directory, "original app")
        await mkdir(project)
        const probe = path.join(project, "host-probe.cjs")
        const args = hostLaunchArgs(issue, probe, project, directory, "cold", "linux")
        const source =
          "if (!process.argv.includes('--no-sandbox')) { console.error('No usable sandbox!'); process.exitCode = 1 } else console.log(JSON.stringify(process.argv.slice(1)))"
        const result = await runCommand(
          process.execPath,
          ["-e", source, "--", ...args],
          directory,
          process.env
        )
        expect(result.code, result.stderr).toBe(0)
        const received: unknown = JSON.parse(result.stdout)
        expect(received).toEqual(args)
        expect(args).toContain("--no-sandbox")
        if (issue === 867) expect(args).toContain(probe)
        else {
          expect(args).toContain(`--extensionDevelopmentPath=${project}`)
          expect(args).toContain(`--extensionTestsPath=${probe}`)
          expect(args).toContain(`--user-data-dir=${path.join(directory, "vscode-user-cold")}`)
        }
        for (const platform of ["darwin", "win32"] as const) {
          expect(hostLaunchArgs(issue, probe, project, directory, "cold", platform)).not.toContain(
            "--no-sandbox"
          )
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }

  it("preserves the probe error and host stderr when the process exits unsuccessfully", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-error-")))
    try {
      const files = {
        log: path.join(directory, "915-disabled.log"),
        result: path.join(directory, "915-disabled.json")
      }
      const report = {
        ...success,
        passed: false,
        errors: ["Error [ERR_REQUIRE_ESM]: get-port rejected"]
      }
      const source = `require('node:fs').writeFileSync(process.argv[1], ${JSON.stringify(JSON.stringify(report))}); console.error('host-stderr-marker'); process.exitCode = 1`
      let failure: unknown
      try {
        await runHostCase(
          process.execPath,
          ["-e", source, files.result],
          directory,
          process.env,
          identity,
          files
        )
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        details: {
          phase: "cold",
          exitCode: 1,
          signal: null,
          timedOut: false,
          stderr: expect.stringContaining("host-stderr-marker"),
          hostResult: report,
          ...files
        }
      })
      expect(String(failure)).toContain("ERR_REQUIRE_ESM")
      expect(String(failure)).toContain("host-stderr-marker")
      expect(String(failure)).toContain(`Log: ${files.log}`)
      expect(String(failure)).toContain(`Result: ${files.result}`)
      expect(String(failure)).not.toContain("1 !== 0")
      expect(await readFile(files.log, "utf8")).toContain("STDERR:\nhost-stderr-marker")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("accepts a successful host process only with its matching probe result", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-success-")))
    try {
      const files = {
        log: path.join(directory, "host.log"),
        result: path.join(directory, "host.json")
      }
      const source = `require('node:fs').writeFileSync(process.argv[1], ${JSON.stringify(JSON.stringify(success))}); console.log('host-success')`
      const details = await runHostCase(
        process.execPath,
        ["-e", source, files.result],
        directory,
        process.env,
        identity,
        files
      )
      expect(details).toMatchObject({
        exitCode: 0,
        signal: null,
        timedOut: false,
        hostResult: success,
        stdout: expect.stringContaining("host-success"),
        ...files
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  for (const code of [0, 2]) {
    it(`keeps startup output when no probe result exists and the exit code is ${code}`, async () => {
      const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-startup-")))
      try {
        const files = {
          log: path.join(directory, "host.log"),
          result: path.join(directory, "host.json")
        }
        const source = `console.log('startup-output'); console.error('startup-failure'); process.exitCode = ${code}`
        await expect(
          runHostCase(process.execPath, ["-e", source], directory, process.env, identity, files)
        ).rejects.toMatchObject({
          details: {
            exitCode: code,
            hostResult: null,
            stdout: expect.stringContaining("startup-output"),
            stderr: expect.stringContaining("startup-failure")
          }
        })
        expect(await readFile(files.log, "utf8")).toContain("startup-failure")
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }

  it("writes timeout output to the host log and failure context", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-timeout-")))
    try {
      const files = {
        log: path.join(directory, "host.log"),
        result: path.join(directory, "host.json")
      }
      const source = "console.error('before-timeout'); setInterval(() => {}, 1000)"
      await expect(
        runHostCase(process.execPath, ["-e", source], directory, process.env, identity, files, 1000)
      ).rejects.toMatchObject({
        message: expect.stringContaining("timed out"),
        details: { timedOut: true, stderr: expect.stringContaining("before-timeout") }
      })
      expect(await readFile(files.log, "utf8")).toContain("before-timeout")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("reports malformed probe JSON with its log instead of masking the host output", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-malformed-")))
    try {
      const files = {
        log: path.join(directory, "host.log"),
        result: path.join(directory, "host.json")
      }
      const source =
        "require('node:fs').writeFileSync(process.argv[1], 'invalid JSON'); console.error('parse-failure-marker')"
      await expect(
        runHostCase(
          process.execPath,
          ["-e", source, files.result],
          directory,
          process.env,
          identity,
          files
        )
      ).rejects.toMatchObject({
        message: expect.stringContaining("Cannot parse host result"),
        details: {
          exitCode: 0,
          stderr: expect.stringContaining("parse-failure-marker"),
          log: files.log
        }
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("diagnoses the previous checker format without assets, a build, or a desktop host", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-diagnose-")))
    try {
      await writeFile(path.join(directory, "867-disabled.log"), "original-electron-startup-error\n")
      await writeFile(path.join(directory, "915-disabled.log"), "original-vscode-startup-error\n")
      await writeFile(
        path.join(directory, "915-disabled.json"),
        JSON.stringify({ errors: ["original-probe-error"] })
      )
      const result = await runCommand(
        process.execPath,
        [
          path.resolve("script/src/esm/verify-hosts.ts"),
          "--assets",
          path.join(directory, "missing-assets"),
          "--diagnose",
          directory
        ],
        process.cwd(),
        process.env
      )
      expect(result.code, result.stderr).toBe(0)
      for (const message of [
        "DIAGNOSE",
        "original-electron-startup-error",
        "original-vscode-startup-error",
        "original-probe-error"
      ])
        expect(result.stdout).toContain(message)
      expect(result.stdout).not.toContain("BUILD")
      expect(result.stdout).not.toContain("PASS")
      expect(await readFile(path.join(directory, "867-disabled.log"), "utf8")).toBe(
        "original-electron-startup-error\n"
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("stages unchanged source and packed dependencies and compiles the original CommonJS import shape", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-prepare-")))
    try {
      const assets = path.join(directory, "assets")
      const issue = path.join(assets, "issue-915")
      await mkdir(path.join(issue, "source"), { recursive: true })
      await mkdir(path.join(issue, "dependencies"))
      const require = createRequire(import.meta.url)
      const Zip = require("adm-zip") as new () => {
        addFile(name: string, data: Buffer): void
        writeZip(file: string): void
      }
      const archive = new Zip()
      const source = "import getPort from 'get-port'; export const port: number = getPort()"
      archive.addFile(
        "original/package.json",
        Buffer.from('{"name":"original-extension","main":"out/extension.js"}')
      )
      archive.addFile("original/src/main.ts", Buffer.from(source))
      archive.addFile(
        "original/src/extension.ts",
        Buffer.from("require = require('esm')(module); module.exports = require('./main.js')")
      )
      archive.writeZip(path.join(issue, "source/reproduction.zip"))
      const packed = path.join(directory, "packed")
      await mkdir(path.join(packed, "package"), { recursive: true })
      await writeFile(
        path.join(packed, "package/package.json"),
        '{"name":"get-port","version":"6.1.2","type":"module"}'
      )
      await writeFile(path.join(packed, "package/index.js"), "export default () => 13604")
      const tar = spawnSync(
        "tar",
        ["-czf", path.join(issue, "dependencies/get-port.tgz"), "-C", packed, "package"],
        { encoding: "utf8" }
      )
      expect(tar.status, tar.stderr || tar.error?.message).toBe(0)
      const files = await Promise.all(
        ["source/reproduction.zip", "dependencies/get-port.tgz"].map(async (file) => ({
          file,
          sha256: createHash("sha256")
            .update(await readFile(path.join(issue, file)))
            .digest("hex")
        }))
      )
      await writeFile(
        path.join(issue, "manifest.json"),
        JSON.stringify({
          files,
          dependencies: {
            npm_tarballs: [
              {
                file: "dependencies/get-port.tgz",
                packages: [{ name: "get-port", version: "6.1.2" }]
              }
            ]
          }
        })
      )
      const project = await prepareProject(915, assets, path.join(directory, "projects"))
      expect(await readFile(path.join(project, "src/main.ts"), "utf8")).toBe(source)
      expect(await readFile(path.join(project, "node_modules/get-port/index.js"), "utf8")).toBe(
        "export default () => 13604"
      )
      const output = await readFile(path.join(project, "out/main.js"), "utf8")
      expect(() => new Script(output)).not.toThrow()
      expect(output).toContain('require("get-port")')
      expect(await readFile(path.join(project, "node_modules/esm/dist/esm.js"))).toEqual(
        await readFile(path.resolve("dist/esm.js"))
      )
      const manifest = JSON.parse(await readFile(path.join(issue, "manifest.json"), "utf8")) as {
        files: { file: string; sha256: string }[]
      }
      for (const file of manifest.files)
        expect(
          createHash("sha256")
            .update(await readFile(path.join(issue, file.file)))
            .digest("hex")
        ).toBe(file.sha256)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
