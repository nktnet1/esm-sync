import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { electronProbe, rendererErrorProbe, vscodeProbe } from "../../script/src/esm/host-probes.ts"
import {
  hostLaunchArgs,
  hostLaunchCommand,
  hostLaunchEnv,
  extractRuntimeZip,
  runHostCase,
  runCommand,
  safeTarget,
  validateReport
} from "../../script/src/esm/verify-hosts-container.ts"
import { Script } from "node:vm"
import { withCompatibilityFiles } from "./helpers/coverage.ts"

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

function writeZip(filename: string, name: string, mode = 0o100755): void {
  const require = createRequire(import.meta.url)
  const Zip = require("adm-zip") as new () => {
    addFile(name: string, content: Buffer): void
    getEntries(): { entryName: string; header: { attr: number } }[]
    writeZip(filename: string): void
  }
  const zip = new Zip()
  zip.addFile("safe-entry", Buffer.from("runtime-bytes"))
  const entry = zip.getEntries()[0]!
  // addFile normalises names, so set the raw entry name to exercise genuinely
  // hostile archives rather than silently sanitising the test's input.
  entry.entryName = name
  entry.header.attr = (mode * 0x10000) >>> 0
  zip.writeZip(filename)
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

  it("requires both window error and native inspector evidence for the renderer reconstruction", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-errors-")))
    try {
      for (const kind of ["syntax", "runtime"])
        await writeFile(path.join(directory, kind + ".js"), "// source\n")
      const expected = {
        ...identity,
        issue: 691,
        loader: path.join(directory, "node_modules/esm/dist/esm.js")
      } as const
      const cases = ["syntax", "runtime"].map((kind) => ({
        kind,
        windowEvent: {
          filename: path.join(directory, kind + ".js"),
          line: 2,
          column: 3,
          stack: kind + ".js:2:3",
          defaultPrevented: false
        },
        exception: {
          stackTrace: { callFrames: [{ url: path.join(directory, kind + ".js"), lineNumber: 1 }] }
        }
      }))
      const report = { ...expected, passed: true, errors: [], version: "8.0.0", cases }
      expect(() => validateReport(report, expected, 0)).not.toThrow()
      for (const change of [
        (value: typeof report) => {
          value.cases.pop()
        },
        (value: typeof report) => {
          value.cases[0]!.windowEvent.defaultPrevented = true
        },
        (value: typeof report) => {
          value.cases[0]!.windowEvent.filename = path.join(directory, "runtime.js")
        },
        (value: typeof report) => {
          value.cases[0]!.windowEvent.line = 1
        },
        (value: typeof report) => {
          value.cases[0]!.windowEvent.column = 0
        },
        (value: typeof report) => {
          value.cases[0]!.windowEvent.stack = "esm.js:1:1"
        },
        (value: typeof report) => {
          value.cases[0]!.exception.stackTrace.callFrames = []
        },
        (value: typeof report) => {
          value.cases[0]!.exception.stackTrace.callFrames[0]!.url = path.join(
            directory,
            "runtime.js"
          )
        },
        (value: typeof report) => {
          value.cases[0]!.exception.stackTrace.callFrames[0]!.lineNumber = 0
        }
      ]) {
        const invalid = structuredClone(report)
        change(invalid)
        expect(() => validateReport(invalid, expected, 0)).toThrow()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
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

  for (const name of [
    "../escape",
    "../extract-sibling/escape",
    "nested/../../escape",
    "/absolute",
    "C:/absolute",
    "dir\\..\\escape",
    "nul\0entry"
  ]) {
    it(`rejects the ZIP entry ${JSON.stringify(name)} before writing any files`, async () => {
      const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-zip-")))
      try {
        const archive = path.join(directory, "runtime.zip")
        const destination = path.join(directory, "extract")
        writeZip(archive, name)
        expect(() => extractRuntimeZip(archive, destination)).toThrow(/archive path/)
        expect(await readdir(destination)).toEqual([])
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }

  it("rejects ZIP symlinks and nonempty destinations containing existing symlinks", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-zip-link-")))
    try {
      const archive = path.join(directory, "runtime.zip")
      const destination = path.join(directory, "extract")
      const outside = path.join(directory, "outside")
      await mkdir(outside)
      writeZip(archive, "link", 0o120777)
      expect(() => extractRuntimeZip(archive, destination)).toThrow(/symlinks/)
      await symlink(outside, path.join(destination, "link"), "junction")
      writeZip(archive, "link/escape")
      expect(() => extractRuntimeZip(archive, destination)).toThrow(/must be empty/)
      expect(await readdir(outside)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("extracts valid nested runtime files through a canonical destination", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-zip-ok-")))
    try {
      const archive = path.join(directory, "runtime.zip")
      const destination = path.join(directory, "extract")
      await mkdir(destination)
      const alias = path.join(directory, "alias")
      await symlink(destination, alias, "junction")
      writeZip(archive, "nested/electron")
      extractRuntimeZip(archive, alias)
      expect(await readFile(path.join(destination, "nested/electron"), "utf8")).toBe(
        "runtime-bytes"
      )
      if (process.platform !== "win32") {
        expect((await stat(path.join(destination, "nested/electron"))).mode & 0o777).toBe(0o755)
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
    expect(() => new Script(rendererErrorProbe)).not.toThrow()
    expect(() => new Script(vscodeProbe)).not.toThrow()
  })

  for (const fails of [false, true]) {
    it(`captures VS Code's protected console and restores its descriptor after ${fails ? "port failure" : "success"}`, async () => {
      const loader = await realpath(path.resolve("dist/esm.js"))
      // Preserve #915's compiled activation shape: an unreturned async IIFE
      // logs the port; the registered command only shows a greeting.
      await withCompatibilityFiles(
        {
          "package.json": '{"name":"vscode-test-getport","main":"out/extension.js"}',
          "out/extension.js": `require = require('esm')(module)
module.exports = require('./main.js')`,
          "out/main.js": `const get_port_1 = require('get-port')
const vscode = require('vscode')
exports.activate = function(context) {
  (async () => { const port = await get_port_1.default({port:13604}); console.log(port) })()
  console.log('Congratulations, your extension "vscode-test-getport" is now active!')
  context.subscriptions.push(vscode.commands.registerCommand('vscode-test-getport.showPort', () => {
    vscode.window.showInformationMessage('Hello from vscode-test-getport!')
  }))
}`,
          "node_modules/get-port/package.json": '{"type":"module","version":"6.1.2"}',
          "node_modules/get-port/index.js": fails
            ? "export default async function() { throw new Error('allocation-rejected') }"
            : `import net from 'node:net'
export default function() {
  return new Promise((resolve,reject) => {
    const server = net.createServer()
    server.on('error',reject)
    server.listen({host:'127.0.0.1',port:0}, () => {
      const port = server.address().port
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}`,
          "host-probe.cjs": vscodeProbe,
          "index.cjs": `const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const nativeLog = console.log
// VS Code 1.66.2 bootstrap-fork.js installs an accessor whose setter is a no-op.
Object.defineProperty(console, 'log', {
  configurable: true, enumerable: true,
  get: () => function(...args) { nativeLog.apply(console,args) },
  set: () => {}
})
const descriptor = Object.getOwnPropertyDescriptor(console,'log')
const commands = new Map()
let greeting = false
const extension = {
  extensionPath: __dirname, isActive: false,
  async activate() {
    require('./out/extension.js').activate({subscriptions:[]})
    this.isActive = true
  }
}
const api = {
  version:'1.66.2',
  extensions:{getExtension(id) {
    assert.equal(id,'undefined_publisher.vscode-test-getport')
    return extension
  }},
  commands:{
    registerCommand(id,callback) { commands.set(id,callback); return {dispose(){}} },
    executeCommand(id) { return commands.get(id)() }
  },
  window:{showInformationMessage(message) {
    assert.equal(message,'Hello from vscode-test-getport!')
    greeting = true
  }}
}
const originalLoad = Module._load
Module._load = function(id) {
  return id === 'vscode' ? api : originalLoad.apply(this,arguments)
}
const config = JSON.parse(process.env.ESM_HOST_CHECK)
;(async () => {
  let failure
  try { await require('./host-probe.cjs').run() } catch(error) { failure = error }
  const report = JSON.parse(fs.readFileSync(config.result,'utf8'))
  assert.deepEqual(Object.getOwnPropertyDescriptor(console,'log'),descriptor)
  assert.ok(greeting)
  assert.equal(report.commandExecuted,true)
  assert.equal(report.passed,${!fails})
  assert.equal(Boolean(failure),${fails})
  ${fails ? "assert.ok(report.errors.some(error => error.includes('allocation-rejected')))" : "assert.ok(report.ports.length > 0)"}
  process.stdout.write('probe-restored\\n')
})().catch(error => { console.error(error); process.exitCode = 1 })`
        },
        async (directory) => {
          await symlink(
            await realpath(process.cwd()),
            path.join(directory, "node_modules/esm"),
            "junction"
          )
          const resultFile = path.join(directory, "probe.json")
          const expected = { ...identity, loader }
          const result = await runCommand(
            process.execPath,
            ["--no-experimental-require-module", "index.cjs"],
            directory,
            {
              ...process.env,
              ESM_DISABLE_CACHE: "true",
              ESM_HOST_CHECK: JSON.stringify({
                ...expected,
                project: directory,
                result: resultFile
              })
            },
            25_000
          )
          expect(result.code, result.stdout + result.stderr).toBe(0)
          expect(result.stdout).toContain("probe-restored")
          const report: unknown = JSON.parse(await readFile(resultFile, "utf8"))
          if (fails) expect(() => validateReport(report, expected, 0)).toThrow()
          else expect(() => validateReport(report, expected, 0)).not.toThrow()
        }
      )
    })
  }

  for (const issue of [867, 915, 691] as const) {
    it(`passes Linux startup flags and private paths intact to host #${issue}`, async () => {
      const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-args ü -")))
      try {
        const project = path.join(directory, "original app")
        await mkdir(project)
        const probe = path.join(project, "host-probe.cjs")
        const args = hostLaunchArgs(issue, probe, project, directory, "cold")
        const source =
          "if (!process.argv.includes('--no-sandbox')) { console.error('No usable sandbox!'); process.exitCode = 1 } else console.log(JSON.stringify(process.argv.slice(1)))"
        const command = hostLaunchCommand(process.execPath, ["-e", source, "--", ...args])
        expect(command.executable).toBe("xvfb-run")
        // Exercise the wrapper boundary with native children without requiring
        // an X server in this tooling regression.
        const wrapper = `const assert = require('node:assert/strict')
const [flag, executable, ...args] = process.argv.slice(1)
assert.equal(flag,'-a')
const result = require('node:child_process').spawnSync(executable,args,{stdio:'inherit'})
if (result.error) throw result.error
process.exitCode = result.status ?? 1`
        const result = await runCommand(
          process.execPath,
          ["-e", wrapper, "--", ...command.args],
          directory,
          process.env
        )
        expect(result.code, result.stderr).toBe(0)
        const received: unknown = JSON.parse(result.stdout)
        expect(received).toEqual(args)
        expect(args).toContain("--no-sandbox")
        if (issue !== 915) expect(args).toContain(probe)
        else {
          expect(args).toContain(`--extensionDevelopmentPath=${project}`)
          expect(args).toContain(`--extensionTestsPath=${probe}`)
          expect(args).toContain(`--user-data-dir=${path.join(directory, "vscode-user-cold")}`)
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }

  it("explains an inaccessible X11 display without mistaking font warnings for a loader failure", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-display-")))
    try {
      const files = {
        log: path.join(directory, "867-disabled.log"),
        result: path.join(directory, "867-disabled.json")
      }
      const source = `console.error('Fontconfig warning: invalid constant');
console.error('Gtk-WARNING **: cannot open display: :0'); process.exitCode = 1`
      await expect(
        runHostCase(
          process.execPath,
          ["-e", source],
          directory,
          process.env,
          { ...identity, issue: 867 },
          files
        )
      ).rejects.toMatchObject({
        message: expect.stringContaining("Check Xvfb startup and Xauthority"),
        details: {
          exitCode: 1,
          hostResult: null,
          stderr: expect.stringContaining("cannot open display: :0")
        }
      })
      expect(await readFile(files.log, "utf8")).toContain("Fontconfig warning")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("uses X11 for the container hosts without changing the inherited environment or Xauthority", async () => {
    const inherited = {
      ...process.env,
      GDK_BACKEND: "wayland",
      WAYLAND_DISPLAY: "wayland-1",
      DISPLAY: ":99",
      XAUTHORITY: path.join(process.cwd(), "private authority ü")
    }
    const snapshot = { ...inherited }
    const env = hostLaunchEnv(inherited)
    const source = `const assert = require('node:assert/strict')
assert.equal(process.env.GDK_BACKEND,process.argv[1])
assert.equal(process.env.DISPLAY,':99')
assert.equal(process.env.WAYLAND_DISPLAY,'wayland-1')
assert.equal(process.env.XAUTHORITY,process.argv[2])
console.log('backend:ok')`
    const result = await runCommand(
      process.execPath,
      ["-e", source, "x11", inherited.XAUTHORITY],
      process.cwd(),
      env
    )
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe("backend:ok")
    expect(inherited).toEqual(snapshot)
    expect(hostLaunchEnv({ DISPLAY: ":99" }).GDK_BACKEND).toBe("x11")
  })

  it("hides Fontconfig console messages while retaining fatal errors and raw diagnostics", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-fonts-")))
    try {
      const files = {
        log: path.join(directory, "867-disabled.log"),
        result: path.join(directory, "867-disabled.json")
      }
      const source = `console.log('Fontconfig warning: stdout-font-warning')
console.log('stdout-kept')
console.error('Fontconfig error: invalid attribute xsi:nil')
console.error('  Fontconfig warning: invalid constant')
console.error('Application warning: font matching failed')
console.error('Gtk-WARNING **: cannot open display: :99')
process.exitCode = 1`
      let failure: unknown
      try {
        await runHostCase(
          process.execPath,
          ["-e", source],
          directory,
          process.env,
          { ...identity, issue: 867 },
          files
        )
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        details: {
          exitCode: 1,
          hostResult: null,
          stderr: expect.stringContaining("Fontconfig error: invalid attribute xsi:nil"),
          stdout: expect.stringContaining("Fontconfig warning: stdout-font-warning")
        }
      })
      const message = String(failure)
      expect(message).toContain("cannot open display: :99")
      expect(message).toContain("Check Xvfb startup and Xauthority")
      expect(message).not.toContain("Re-run with --xvfb")
      expect(message).toContain("Application warning: font matching failed")
      expect(message).toContain("stdout-kept")
      for (const diagnostic of [
        "Fontconfig warning: stdout-font-warning",
        "Fontconfig error: invalid attribute xsi:nil",
        "Fontconfig warning: invalid constant"
      ]) {
        expect(message).not.toContain(diagnostic)
        expect(await readFile(files.log, "utf8")).toContain(diagnostic)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

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
        runHostCase(process.execPath, ["-e", source], directory, process.env, identity, files, {
          timeout: 1000
        })
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
})
