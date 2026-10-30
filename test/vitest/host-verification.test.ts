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
