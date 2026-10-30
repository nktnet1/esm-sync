import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, styleText } from "node:util"
import { electronProbe, vscodeProbe } from "./host-probes.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const require = createRequire(import.meta.url)
type ZipEntry = { entryName: string; isDirectory: boolean; attr: number; getData(): Buffer }
type Zip = { getEntries(): ZipEntry[] }
type Manifest = {
  files: { file: string; sha256: string }[]
  dependencies: {
    npm_tarballs: { file: string; packages: { name: string; version: string }[] }[]
  }
}
type Phase = "disabled" | "cold" | "warm"
type Identity = { issue: 867 | 915; phase: Phase; nonce: string; loader: string }
type CommandResult = {
  code: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  stdout: string
  stderr: string
}
type CaseDetails = {
  phase: Phase
  command: { executable: string; args: string[]; cwd: string }
  log: string
  result: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  stdout: string
  stderr: string
  hostResult: unknown
}
type CaseOptions = { timeout?: number; quietFontconfig?: boolean; xvfb?: boolean }

class HostProcessError extends Error {
  readonly result: CommandResult

  constructor(message: string, result: CommandResult) {
    super(message)
    this.result = result
  }
}

class HostCaseError extends Error {
  readonly details: CaseDetails

  constructor(message: string, details: CaseDetails) {
    super(message)
    this.details = details
  }
}

function hash(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

export function safeTarget(directory: string, filename: string): string {
  assert.ok(!filename.includes("\\") && !/^[A-Za-z]:/.test(filename), "Invalid archive path")
  assert.ok(
    !path.posix.isAbsolute(filename) && !filename.split("/").includes(".."),
    "Invalid archive path"
  )
  return path.join(directory, filename)
}

function unzip(archive: string, destination: string, stripRoot = false): void {
  const AdmZip = require("adm-zip") as new (file: string) => Zip
  mkdirSync(destination, { recursive: true })
  for (const entry of new AdmZip(archive).getEntries()) {
    safeTarget(destination, entry.entryName)
    assert.notEqual((entry.attr >>> 16) & 0o170000, 0o120000, "ZIP symlinks are not supported")
    const name = stripRoot ? entry.entryName.split("/").slice(1).join("/") : entry.entryName
    if (!name || entry.isDirectory) continue
    const target = safeTarget(destination, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, entry.getData())
    const mode = (entry.attr >>> 16) & 0o777
    if (mode & 0o111) chmodSync(target, mode)
  }
}

function asset(directory: string, manifest: Manifest, name: string): string {
  const file = safeTarget(directory, name)
  const expected = manifest.files.find((item) => item.file === name)?.sha256
  assert.match(expected ?? "", /^[a-f0-9]{64}$/, `No checksum for ${name}`)
  assert.equal(hash(file), expected, `Asset checksum mismatch: ${name}`)
  return file
}

function tar(archive: string, args: string[]): Buffer {
  const result = spawnSync("tar", [...args, archive], { maxBuffer: 32 * 1024 * 1024 })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr.toString())
  return result.stdout
}

function tarMember(archive: string, name: string): Buffer {
  const result = spawnSync("tar", ["-xOzf", archive, name], { maxBuffer: 32 * 1024 * 1024 })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr.toString())
  return result.stdout
}

export async function runCommand(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout = 90_000
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: "pipe",
      detached: process.platform !== "win32"
    })
    child.stdin.end()
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let force: ReturnType<typeof setTimeout> | undefined
    function terminate(signal: NodeJS.Signals): void {
      if (process.platform === "win32") {
        if (signal === "SIGKILL" && child.pid)
          spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"])
        else child.kill(signal)
      } else if (child.pid) {
        try {
          process.kill(-child.pid, signal)
        } catch (error) {
          if (!record(error) || error.code !== "ESRCH") throw error
        }
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      terminate("SIGTERM")
      force = setTimeout(() => terminate("SIGKILL"), 2_000)
    }, timeout)
    const onExit = () => terminate("SIGKILL")
    const onInterrupt = () => process.exit(130)
    const onTerminate = () => process.exit(143)
    process.once("exit", onExit)
    process.once("SIGINT", onInterrupt)
    process.once("SIGTERM", onTerminate)
    function cleanup(): void {
      clearTimeout(timer)
      clearTimeout(force)
      process.removeListener("exit", onExit)
      process.removeListener("SIGINT", onInterrupt)
      process.removeListener("SIGTERM", onTerminate)
    }
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-1_000_000)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-1_000_000)
    })
    child.once("error", (error) => {
      cleanup()
      reject(
        new HostProcessError(error.message, { code: null, signal: null, timedOut, stdout, stderr })
      )
    })
    child.once("close", (code, signal) => {
      cleanup()
      const result = { code, signal, timedOut, stdout, stderr }
      if (timedOut) reject(new HostProcessError(`Host timed out after ${timeout}ms`, result))
      else resolve(result)
    })
  })
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function validateReport(value: unknown, expected: Identity, code: number | null): void {
  if (code !== 0) throw new Error(`Host exited unsuccessfully (exit code ${code ?? "unavailable"})`)
  assert.ok(record(value), "Host did not write a result object")
  for (const [key, identity] of Object.entries(expected)) {
    assert.equal(value[key], identity, `Unexpected host result: ${key}`)
  }
  assert.equal(value.passed, true, JSON.stringify(value.errors))
  assert.deepEqual(value.errors, [], "Host reported runtime errors")
  if (expected.issue === 867) {
    assert.ok(Array.isArray(value.loads) && value.loads.length === 4, "Missing renderer reloads")
    const loads: unknown[] = value.loads
    for (const [index, load] of loads.entries()) {
      assert.ok(record(load) && record(load.versions))
      assert.equal(load.index, index)
      assert.equal(load.hello, 1)
      assert.equal(load.versions.electron, "8.0.0")
    }
  } else {
    assert.equal(value.version, "1.66.2")
    assert.equal(value.commandExecuted, true)
    assert.ok(Array.isArray(value.ports) && value.ports.length > 0, "Missing allocated port")
    assert.ok(
      value.ports.every(
        (port: unknown) =>
          typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535
      )
    )
  }
}

function probeErrors(value: unknown): string[] {
  return record(value) && Array.isArray(value.errors)
    ? value.errors.filter((error: unknown): error is string => typeof error === "string")
    : []
}

function tail(value: string): string {
  return value.length > 12_000
    ? "[earlier output omitted; see full log]\n" + value.slice(-12_000)
    : value
}

function consoleOutput(value: string, quietFontconfig: boolean): string {
  return quietFontconfig
    ? value
        .split("\n")
        .filter((line) => !/^\s*Fontconfig (?:warning|error):/.test(line))
        .join("\n")
    : value
}

export async function runHostCase(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  identity: Identity,
  files: { log: string; result: string },
  options: CaseOptions = {}
): Promise<CaseDetails> {
  let result: CommandResult
  let processError = ""
  try {
    result = await runCommand(executable, args, cwd, env, options.timeout)
  } catch (error) {
    if (!(error instanceof HostProcessError)) throw error
    result = error.result
    processError = error.message
  }
  const command = { executable, args, cwd }
  writeFileSync(
    files.log,
    `Command: ${JSON.stringify(command)}\nExit code: ${result.code}\nSignal: ${result.signal}\nTimed out: ${result.timedOut}\n\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  )
  let report: unknown = null
  let reportError = ""
  if (existsSync(files.result)) {
    try {
      report = JSON.parse(readFileSync(files.result, "utf8")) as unknown
    } catch (error) {
      reportError = `Cannot parse host result: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  const details: CaseDetails = {
    phase: identity.phase,
    command,
    ...files,
    exitCode: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    hostResult: report
  }
  try {
    if (processError) throw new Error(processError)
    if (reportError) throw new Error(reportError)
    validateReport(report, identity, result.code)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const errors = probeErrors(report)
    const stderr = consoleOutput(result.stderr, options.quietFontconfig ?? false).trim()
    const stdout = consoleOutput(result.stdout, options.quietFontconfig ?? false).trim()
    const message = [
      reason,
      ...(/cannot open display|unable to open x display|missing x server or \$DISPLAY/i.test(
        result.stderr
      )
        ? [
            options.xvfb
              ? "Cannot connect to the Xvfb display with GDK_BACKEND=x11. Check Xvfb startup and Xauthority; see the full log."
              : "X11 display is unavailable. Re-run with --xvfb (requires installed Xvfb and xauth)."
          ]
        : []),
      ...(result.signal ? [`Signal: ${result.signal}`] : []),
      ...(errors.length ? ["Host error:\n" + errors.join("\n")] : []),
      ...(stderr ? ["stderr:\n" + tail(stderr)] : []),
      ...(stdout ? ["stdout:\n" + tail(stdout)] : []),
      `Log: ${files.log}`,
      `Result: ${files.result}`
    ].join("\n")
    throw new HostCaseError(message, details)
  }
  return details
}

export function diagnoseHostLogs(directory: string, quietFontconfig = false): void {
  const base = realpathSync(directory)
  let found = false
  for (const issue of [867, 915]) {
    for (const phase of ["disabled", "cold", "warm"]) {
      const log = path.join(base, `${issue}-${phase}.log`)
      const result = path.join(base, `${issue}-${phase}.json`)
      if (!existsSync(log) && !existsSync(result)) continue
      found = true
      console.log(`${styleText("cyan", "DIAGNOSE")} #${issue} ${phase}`)
      if (existsSync(result)) {
        try {
          const value: unknown = JSON.parse(readFileSync(result, "utf8"))
          const errors = probeErrors(value)
          if (errors.length) console.log("Host error:\n" + errors.join("\n"))
        } catch (error) {
          console.log(`Cannot parse ${result}: ${String(error)}`)
        }
        console.log(`Result: ${result}`)
      }
      if (existsSync(log))
        console.log(
          `Log: ${log}\n${tail(consoleOutput(readFileSync(log, "utf8"), quietFontconfig).trim())}`
        )
    }
  }
  assert.ok(found, `No host logs or probe results found in ${base}`)
}

export async function prepareProject(
  issue: 867 | 915,
  assets: string,
  directory: string
): Promise<string> {
  const source = path.join(assets, `issue-${issue}`)
  const manifest: Manifest = JSON.parse(readFileSync(path.join(source, "manifest.json"), "utf8"))
  const project = path.join(directory, `issue-${issue}`)
  unzip(asset(source, manifest, "source/reproduction.zip"), project, true)
  const loader = path.join(project, "node_modules/esm")
  for (const file of [
    "package.json",
    "esm.js",
    "index.js",
    "dist/esm.js",
    "dist/index.js",
    "dist/esm/loader.js"
  ]) {
    mkdirSync(path.dirname(path.join(loader, file)), { recursive: true })
    cpSync(path.join(root, file), path.join(loader, file))
  }
  cpSync(
    realpathSync(path.join(root, "node_modules/punycode")),
    path.join(loader, "node_modules/punycode"),
    { recursive: true }
  )
  if (issue === 915) {
    const dependency = manifest.dependencies.npm_tarballs.find((item) =>
      item.packages.some((pkg) => pkg.name === "get-port" && pkg.version === "6.1.2")
    )
    assert.ok(dependency, "Attached get-port@6.1.2 was not found")
    const archive = asset(source, manifest, dependency.file)
    const target = path.join(project, "node_modules/get-port")
    mkdirSync(target, { recursive: true })
    for (const name of ["package.json", "index.js"])
      writeFileSync(path.join(target, name), tarMember(archive, "package/" + name))
    const ts = await import("typescript")
    mkdirSync(path.join(project, "out"))
    for (const name of ["extension", "main"]) {
      const input = path.join(project, "src", name + ".ts")
      const result = ts.transpileModule(readFileSync(input, "utf8"), {
        fileName: input,
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.CommonJS,
          // Preserve the original TS 4.x CommonJS default-import semantics.
          esModuleInterop: false,
          ignoreDeprecations: "6.0"
        },
        reportDiagnostics: true
      })
      assert.equal(
        result.diagnostics?.length ?? 0,
        0,
        "Extension transpilation failed: " +
          result.diagnostics
            ?.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
            .join("\n")
      )
      writeFileSync(path.join(project, "out", name + ".js"), result.outputText)
    }
  }
  return realpathSync(project)
}

function runtime(issue: 867 | 915, assets: string, directory: string, override?: string): string {
  if (override) return realpathSync(override)
  assert.ok(
    process.platform === "linux" && process.arch === "x64",
    `Attached runtimes are Linux x64. Supply --${issue === 867 ? "electron" : "vscode"} for your OS.`
  )
  const source = path.join(assets, `issue-${issue}`)
  const manifest: Manifest = JSON.parse(readFileSync(path.join(source, "manifest.json"), "utf8"))
  const target = path.join(directory, `runtime-${issue}`)
  mkdirSync(target)
  if (issue === 867) {
    unzip(asset(source, manifest, "dependencies/electron/electron-v8.0.0-linux-x64.zip"), target)
  } else {
    const archive = asset(
      source,
      manifest,
      "validation/assets/vscode/vscode-1.66.2-linux-x64.tar.gz"
    )
    const listing = tar(archive, ["-tzf"]).toString().split("\n").filter(Boolean)
    for (const name of listing) safeTarget(target, name)
    const result = spawnSync(
      "tar",
      ["-xzf", archive, "--no-same-owner", "--strip-components=1", "-C", target],
      {
        encoding: "utf8"
      }
    )
    assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  }
  const executable = path.join(target, issue === 867 ? "electron" : "code")
  chmodSync(executable, 0o755)
  return realpathSync(executable)
}

function preflight(executable: string, xvfb: boolean): void {
  if (process.platform !== "linux") return
  const libraries = spawnSync("ldd", [executable], { encoding: "utf8" })
  const missing = libraries.stdout?.split("\n").filter((line) => line.includes("not found")) ?? []
  assert.equal(missing.length, 0, `Missing desktop libraries:\n${missing.join("\n")}`)
  if (xvfb) {
    const wrapper = spawnSync("xvfb-run", ["--help"], { encoding: "utf8", timeout: 5_000 })
    assert.equal(
      wrapper.status,
      0,
      `--xvfb requires installed Xvfb, xvfb-run and xauth. ${wrapper.error?.message ?? wrapper.stderr}`
    )
  } else {
    assert.ok(
      process.env.DISPLAY,
      "No X11 display. Use --xvfb with installed Xvfb/xauth, or run in a working X11 desktop session."
    )
  }
}

export function hostLaunchCommand(
  executable: string,
  args: string[],
  xvfb: boolean,
  platform: NodeJS.Platform = process.platform
): { executable: string; args: string[] } {
  assert.ok(!xvfb || platform === "linux", "--xvfb is supported only on Linux")
  return xvfb ? { executable: "xvfb-run", args: ["-a", executable, ...args] } : { executable, args }
}

export function hostLaunchEnv(
  env: NodeJS.ProcessEnv,
  issue: 867 | 915,
  xvfb: boolean,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  // Electron 8 needs X11, and Xvfb is an X11 server. A Wayland-only GTK
  // backend inherited from the desktop can reject even a valid DISPLAY=:99.
  // Scope the override to these test children and preserve X11 authentication.
  return {
    ...env,
    ...(platform === "linux" && (issue === 867 || xvfb) ? { GDK_BACKEND: "x11" } : {})
  }
}

export function hostLaunchArgs(
  issue: 867 | 915,
  probe: string,
  project: string,
  directory: string,
  phase: Phase,
  platform: NodeJS.Platform = process.platform
): string[] {
  // These historical runtimes are unpacked into a private test directory.
  // Their Linux SUID helper is not installed as root-owned mode 4755, and
  // modern hosts may also prohibit unprivileged user namespaces. Limit this
  // testing-only flag to the disposable verifier processes, regardless of UID.
  const flags = platform === "linux" ? ["--no-sandbox"] : []
  return issue === 867
    ? [...flags, probe]
    : [
        ...flags,
        "--disable-extensions",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        `--user-data-dir=${path.join(directory, `vscode-user-${phase}`)}`,
        `--extensions-dir=${path.join(directory, "vscode-extensions")}`,
        `--extensionDevelopmentPath=${project}`,
        `--extensionTestsPath=${probe}`
      ]
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      assets: { type: "string", default: "../issue-assets" },
      electron: { type: "string" },
      vscode: { type: "string" },
      diagnose: { type: "string" },
      xvfb: { type: "boolean", default: false },
      "quiet-fontconfig": { type: "boolean", default: false },
      "skip-build": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  })
  if (values.help) {
    console.log(
      "pnpm verify:hosts --assets <folder containing issue-867 and issue-915>\nBuilds the fork and runs real Electron 8.0.0 / VS Code 1.66.2 checks.\n--electron <binary> --vscode <binary> override the attached Linux x64 runtimes.\n--xvfb launches each Linux host through installed xvfb-run -a, without needing a desktop display.\n--quiet-fontconfig hides Fontconfig warning/error lines in the console; full logs and JSON retain them.\n--skip-build uses existing dist output. No downloads or dependency installation.\n--diagnose <report-directory> reads existing host logs without building or launching apps."
    )
    return
  }
  if (values.diagnose) {
    diagnoseHostLogs(values.diagnose, values["quiet-fontconfig"])
    return
  }
  assert.ok(!values.xvfb || process.platform === "linux", "--xvfb is supported only on Linux")
  const assets = realpathSync(values.assets)
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-sync-hosts-")))
  const samples: Record<string, unknown>[] = []
  const output = path.join(directory, "report.json")
  writeFileSync(output, JSON.stringify({ passed: false, samples }, null, 2))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: "",
    NODE_ENV: "production",
    ESM_ENV: "production"
  }
  delete env.ELECTRON_RUN_AS_NODE
  console.log(`${styleText("cyan", "REPORT")} ${output}`)
  if (!values["skip-build"]) {
    console.log(`${styleText("cyan", "BUILD")} production loader`)
    const result = await runCommand(
      process.execPath,
      [path.join(root, "script/src/esm/cli.ts"), "build", "--prod"],
      root,
      env,
      180_000
    )
    writeFileSync(path.join(directory, "build.log"), result.stdout + result.stderr)
    assert.equal(result.code, 0, `Build failed; see ${path.join(directory, "build.log")}`)
  }
  for (const issue of [867, 915] as const) {
    let context: Record<string, unknown> = {}
    try {
      const executable = runtime(
        issue,
        assets,
        directory,
        issue === 867 ? values.electron : values.vscode
      )
      preflight(executable, values.xvfb)
      const project = await prepareProject(issue, assets, directory)
      const loader = realpathSync(path.join(project, "node_modules/esm/dist/esm.js"))
      const probe = path.join(project, "host-probe.cjs")
      writeFileSync(probe, issue === 867 ? electronProbe : vscodeProbe)
      const compilerCache = path.join(project, "compiler-cache")
      const bootstrapCache = path.join(
        project,
        "node_modules/esm/node_modules/.cache/esm/.data.json"
      )
      for (const phase of ["disabled", "cold", "warm"] as const) {
        const identity: Identity = { issue, phase, nonce: randomUUID(), loader }
        const resultFile = path.join(directory, `${issue}-${phase}.json`)
        const config = { ...identity, project, result: resultFile }
        const cacheExists =
          existsSync(path.join(compilerCache, ".data.json")) && existsSync(bootstrapCache)
        assert.equal(cacheExists, phase === "warm", "Unexpected cache state before host launch")
        const command = hostLaunchCommand(
          executable,
          hostLaunchArgs(issue, probe, project, directory, phase),
          values.xvfb
        )
        const files = { log: path.join(directory, `${issue}-${phase}.log`), result: resultFile }
        context = { phase, ...files, command: { ...command, cwd: project } }
        const details = await runHostCase(
          command.executable,
          command.args,
          project,
          {
            ...hostLaunchEnv(env, issue, values.xvfb),
            ESM_DISABLE_CACHE: String(phase === "disabled"),
            ESM_OPTIONS: JSON.stringify({ cache: phase === "disabled" ? false : compilerCache }),
            ESM_HOST_CHECK: JSON.stringify(config)
          },
          identity,
          files,
          { quietFontconfig: values["quiet-fontconfig"], xvfb: values.xvfb }
        )
        context = { ...details }
        assert.equal(
          existsSync(bootstrapCache),
          phase !== "disabled",
          "Unexpected bootstrap cache after launch"
        )
        assert.equal(
          existsSync(path.join(compilerCache, ".data.json")),
          phase !== "disabled",
          "Unexpected compiler cache after launch"
        )
        samples.push({ issue, phase, passed: true, executable, result: resultFile, log: files.log })
        console.log(
          `${styleText("green", "PASS")} #${issue} ${phase}${issue === 867 ? " - first load + 3 reloads" : " - activation + command + allocated port"}`
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      samples.push({
        issue,
        ...context,
        ...(error instanceof HostCaseError ? error.details : {}),
        passed: false,
        error: message
      })
      console.error(`${styleText("red", "FAIL")} #${issue} ${message}`)
    }
  }
  const passed = samples.length === 6 && samples.every((sample) => sample.passed)
  writeFileSync(
    output,
    JSON.stringify(
      { passed, loaderSHA256: hash(path.join(root, "dist/esm/loader.js")), samples },
      null,
      2
    )
  )
  console.log(
    `${styleText(passed ? "green" : "red", passed ? "PASS" : "FAIL")} host verification; report: ${output}`
  )
  if (!passed) process.exitCode = 1
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch((error: unknown) => {
    console.error(
      `${styleText("red", "FAIL")} ${error instanceof Error ? error.message : String(error)}`
    )
    process.exitCode = 1
  })
}
