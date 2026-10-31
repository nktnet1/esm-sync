import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { styleText } from "node:util"
import { electronProbe, rendererErrorProbe, vscodeProbe } from "./host-probes.ts"
import { hostRuntimeCache, hostRuntimes } from "./host-runtimes.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const require = createRequire(import.meta.url)
type ZipEntry = { entryName: string; isDirectory: boolean; attr: number; getData(): Buffer }
type Zip = { getEntries(): ZipEntry[] }
type Phase = "disabled" | "cold" | "warm"
type Issue = 691 | 867 | 915
type Identity = { issue: Issue; phase: Phase; nonce: string; loader: string }
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
  assert.ok(
    !filename.includes("\\") && !filename.includes("\0") && !/^[A-Za-z]:/.test(filename),
    "Invalid archive path"
  )
  assert.ok(
    !path.posix.isAbsolute(filename) && !filename.split("/").includes(".."),
    "Invalid archive path"
  )
  const target = path.resolve(directory, filename)
  if (!target.startsWith(path.resolve(directory) + path.sep))
    throw new Error("Invalid archive path")
  return target
}

export function extractRuntimeZip(archive: string, destination: string): void {
  const AdmZip = require("adm-zip") as new (file: string) => Zip
  mkdirSync(destination, { recursive: true })
  const directory = realpathSync(destination)
  assert.equal(readdirSync(directory).length, 0, "ZIP destination must be empty")
  for (const entry of new AdmZip(archive).getEntries()) {
    // Keep the resolved-path containment guard at the filesystem sink so both
    // runtime checks and archive-entry dataflow analysis can follow it.
    const target = path.resolve(directory, entry.entryName)
    if (!target.startsWith(directory + path.sep)) throw new Error("Invalid archive path")
    safeTarget(directory, entry.entryName)
    assert.notEqual((entry.attr >>> 16) & 0o170000, 0o120000, "ZIP symlinks are not supported")
    if (entry.isDirectory) continue
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, entry.getData())
    const mode = (entry.attr >>> 16) & 0o777
    if (mode & 0o111) chmodSync(target, mode)
  }
}

function tar(archive: string, args: string[]): Buffer {
  const result = spawnSync("tar", [...args, archive], { maxBuffer: 32 * 1024 * 1024 })
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
  } else if (expected.issue === 691) {
    assert.equal(value.version, "8.0.0")
    assert.ok(
      Array.isArray(value.cases) && value.cases.length === 2,
      "Missing renderer error cases"
    )
    for (const [index, kind] of ["syntax", "runtime"].entries()) {
      const item: unknown = value.cases[index]
      assert.ok(
        record(item) && item.kind === kind && record(item.windowEvent) && record(item.exception)
      )
      const expectedFile = realpathSync(
        path.resolve(path.dirname(expected.loader), "../../..", kind + ".js")
      )
      const event = item.windowEvent
      assert.equal(typeof event.filename, "string")
      const filename = String(event.filename)
      assert.equal(
        realpathSync(filename.startsWith("file:") ? fileURLToPath(filename) : filename),
        expectedFile
      )
      assert.equal(event.line, 2)
      assert.ok(typeof event.column === "number" && event.column > 0)
      assert.equal(event.defaultPrevented, false)
      assert.ok(typeof event.stack === "string" && event.stack.includes(kind + ".js"))
      const trace = item.exception.stackTrace
      assert.ok(record(trace) && Array.isArray(trace.callFrames))
      const frame: unknown = trace.callFrames[0]
      assert.ok(record(frame) && typeof frame.url === "string")
      assert.equal(
        realpathSync(frame.url.startsWith("file:") ? fileURLToPath(frame.url) : frame.url),
        expectedFile
      )
      assert.equal(frame.lineNumber, 1)
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

function consoleOutput(value: string): string {
  return value
    .split("\n")
    .filter((line) => !/^\s*Fontconfig (?:warning|error):/.test(line))
    .join("\n")
}

export async function runHostCase(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  identity: Identity,
  files: { log: string; result: string },
  options: { timeout?: number } = {}
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
    const stderr = consoleOutput(result.stderr).trim()
    const stdout = consoleOutput(result.stdout).trim()
    const message = [
      reason,
      ...(/cannot open display|unable to open x display|missing x server or \$DISPLAY/i.test(
        result.stderr
      )
        ? [
            "Cannot connect to the Xvfb display with GDK_BACKEND=x11. Check Xvfb startup and Xauthority; see the full log."
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

export async function prepareProject(issue: Issue, directory: string): Promise<string> {
  const source = path.join(root, "test/fixture/hosts", `issue-${issue}`)
  const project = path.join(directory, `issue-${issue}`)
  cpSync(source, project, { recursive: true })
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
    const target = path.join(project, "node_modules/get-port")
    cpSync(path.join(root, "test/fixture/hosts/get-port-6.1.2"), target, { recursive: true })
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

function runtime(issue: Issue, directory: string): string {
  const input = hostRuntimes.find((item) => item.issue === (issue === 691 ? 867 : issue))!
  const archive = path.join(hostRuntimeCache, input.file)
  assert.ok(existsSync(archive), `Host image is missing runtime archive: ${input.file}`)
  assert.equal(hash(archive), input.sha256, `Runtime checksum mismatch: ${input.file}`)
  const target = path.join(directory, `runtime-${issue}`)
  mkdirSync(target)
  if (issue !== 915) {
    extractRuntimeZip(archive, target)
  } else {
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
  const executable = path.join(target, issue !== 915 ? "electron" : "code")
  chmodSync(executable, 0o755)
  return realpathSync(executable)
}

function preflight(executable: string): void {
  const libraries = spawnSync("ldd", [executable], { encoding: "utf8" })
  const missing = libraries.stdout?.split("\n").filter((line) => line.includes("not found")) ?? []
  assert.equal(missing.length, 0, `Missing desktop libraries:\n${missing.join("\n")}`)
  const wrapper = spawnSync("xvfb-run", ["--help"], { encoding: "utf8", timeout: 5_000 })
  assert.equal(
    wrapper.status,
    0,
    `Host image requires Xvfb, xvfb-run and xauth. ${wrapper.error?.message ?? wrapper.stderr}`
  )
}

export function hostLaunchCommand(
  executable: string,
  args: string[]
): { executable: string; args: string[] } {
  return { executable: "xvfb-run", args: ["-a", executable, ...args] }
}

export function hostLaunchEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Both historical hosts use Xvfb, which requires the X11 GTK backend.
  return { ...env, GDK_BACKEND: "x11" }
}

export function hostLaunchArgs(
  issue: Issue,
  probe: string,
  project: string,
  directory: string,
  phase: Phase
): string[] {
  // These historical runtimes are unpacked into a private test directory.
  // Their Linux SUID helper is not installed as root-owned mode 4755, and
  // modern hosts may also prohibit unprivileged user namespaces. Limit this
  // testing-only flag to the disposable verifier processes, regardless of UID.
  const flags = ["--no-sandbox"]
  return issue !== 915
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

// Internal image entry point. The Dockerfile supplies the production build,
// checked-in reproductions, pinned runtimes and display dependencies.
export async function verifyHostsContainer(reportDirectory: string): Promise<void> {
  assert.ok(
    process.platform === "linux" && process.arch === "x64",
    "Use the Linux/amd64 host image"
  )
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-sync-hosts-")))
  mkdirSync(reportDirectory, { recursive: true })
  const reports = realpathSync(reportDirectory)
  const samples: Record<string, unknown>[] = []
  const output = path.join(reports, "report.json")
  writeFileSync(output, JSON.stringify({ passed: false, samples }, null, 2))
  cpSync(path.join(hostRuntimeCache, "inputs.json"), path.join(reports, "inputs.json"))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: "",
    NODE_ENV: "production",
    ESM_ENV: "production"
  }
  delete env.ELECTRON_RUN_AS_NODE
  console.log(`${styleText("cyan", "REPORT")} ${output}`)
  for (const issue of [867, 915, 691] as const) {
    let context: Record<string, unknown> = {}
    try {
      const executable = runtime(issue, directory)
      preflight(executable)
      const project = await prepareProject(issue, directory)
      const loader = realpathSync(path.join(project, "node_modules/esm/dist/esm.js"))
      const probe = path.join(project, "host-probe.cjs")
      writeFileSync(
        probe,
        issue === 867 ? electronProbe : issue === 691 ? rendererErrorProbe : vscodeProbe
      )
      const compilerCache = path.join(project, "compiler-cache")
      const bootstrapCache = path.join(
        project,
        "node_modules/esm/node_modules/.cache/esm/.data.json"
      )
      for (const phase of ["disabled", "cold", "warm"] as const) {
        const identity: Identity = { issue, phase, nonce: randomUUID(), loader }
        const resultFile = path.join(reports, `${issue}-${phase}.json`)
        const config = { ...identity, project, result: resultFile }
        const cacheExists =
          existsSync(path.join(compilerCache, ".data.json")) && existsSync(bootstrapCache)
        assert.equal(cacheExists, phase === "warm", "Unexpected cache state before host launch")
        const command = hostLaunchCommand(
          executable,
          hostLaunchArgs(issue, probe, project, directory, phase)
        )
        const files = { log: path.join(reports, `${issue}-${phase}.log`), result: resultFile }
        context = { phase, ...files, command: { ...command, cwd: project } }
        const details = await runHostCase(
          command.executable,
          command.args,
          project,
          {
            ...hostLaunchEnv(env),
            ESM_DISABLE_CACHE: String(phase === "disabled"),
            ESM_OPTIONS: JSON.stringify({ cache: phase === "disabled" ? false : compilerCache }),
            ESM_HOST_CHECK: JSON.stringify(config)
          },
          identity,
          files
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
          `${styleText("green", "PASS")} #${issue} ${phase}${issue === 867 ? " - first load + 3 reloads" : issue === 691 ? " - renderer syntax + runtime error locations" : " - activation + command + allocated port"}`
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
  const passed = samples.length === 9 && samples.every((sample) => sample.passed)
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
  verifyHostsContainer("/reports").catch((error: unknown) => {
    console.error(
      `${styleText("red", "FAIL")} ${error instanceof Error ? error.message : String(error)}`
    )
    process.exitCode = 1
  })
}
