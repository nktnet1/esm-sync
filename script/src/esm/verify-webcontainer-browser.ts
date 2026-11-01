import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { hostFailureText, hostLabel } from "./host-output.ts"
import { hostWebContainerSdk } from "./host-runtimes.ts"
import { webContainerBrowserPage } from "./webcontainer-browser-page.ts"
import { exportWebContainerKit } from "./webcontainer-kit.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
type TreeEntry = { file: { contents: string } } | { directory: FileTree }
type FileTree = { [name: string]: TreeEntry }
type BrowserIdentity = { nonce: string; loaderSHA256: string }
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function webContainerFileTree(directory: string): FileTree {
  return Object.fromEntries<TreeEntry>(
    readdirSync(directory).map((name): [string, TreeEntry] => {
      const file = path.join(directory, name),
        info = lstatSync(file)
      assert.ok(!info.isSymbolicLink(), "WebContainer input must not contain symlinks")
      if (info.isDirectory()) return [name, { directory: webContainerFileTree(file) }]
      assert.ok(info.isFile(), "WebContainer input must be a regular file")
      const bytes = readFileSync(file),
        contents = bytes.toString("utf8")
      assert.ok(Buffer.from(contents).equals(bytes), "WebContainer input must be UTF-8 text")
      return [name, { file: { contents } }]
    })
  )
}

export function validateWebContainerBrowserReport(value: unknown, expected: BrowserIdentity): void {
  assert.ok(object(value), "Missing real WebContainer report")
  assert.equal(value.nonce, expected.nonce, "Unexpected browser run nonce")
  assert.equal(value.loaderSHA256, expected.loaderSHA256, "WebContainer tested a different loader")
  assert.equal(value.issue, 917)
  assert.equal(value.passed, true, "Real WebContainer verification failed")
  assert.equal(value.blocked, false)
  assert.equal(value.booted, true, "The WebContainer SDK did not boot")
  assert.equal(value.crossOriginIsolated, true, "The browser was not cross-origin isolated")
  assert.equal(value.scope, "actual-webcontainer-application")
  assert.equal(value.reproduction, "reconstructed-consumer")
  assert.equal(value.sdkVersion, "1.6.4")
  assert.equal(value.sdkSHA256, hostWebContainerSdk.sha256)
  assert.equal(value.code, 0)
  assert.ok(typeof value.browserVersion === "string" && value.browserVersion.length > 0)
  assert.ok(object(value.worker) && object(value.artifacts))
  const worker = value.worker,
    artifacts = value.artifacts
  assert.equal(worker.passed, true)
  assert.equal(worker.scope, "actual-webcontainer-application")
  assert.equal(worker.loaderSHA256, expected.loaderSHA256)
  assert.ok(
    Array.isArray(worker.samples) && worker.samples.length === 3,
    "Missing real-host cache cases"
  )
  const phases = new Set<string>()
  for (const item of worker.samples as unknown[]) {
    assert.ok(object(item) && ["disabled", "cold", "warm"].includes(String(item.phase)))
    assert.equal(item.passed, true)
    assert.equal(item.scope, "actual-webcontainer")
    assert.ok(typeof item.nonce === "string" && typeof item.loader === "string")
    phases.add(String(item.phase))
    assert.equal(
      typeof artifacts[String(item.phase) + ".json"],
      "string",
      "Missing VM probe artifact"
    )
    const probe: unknown = JSON.parse(String(artifacts[String(item.phase) + ".json"]))
    assert.ok(object(probe) && object(probe.versions))
    assert.equal(probe.nonce, item.nonce)
    assert.equal(probe.loader, item.loader)
    assert.equal(probe.scope, "actual-webcontainer")
    assert.notEqual(probe.emulate, true, "Real WebContainer verification used VM emulation")
    assert.equal(probe.sharedRealm, true)
    assert.equal(probe.imports, 2)
    assert.equal(probe.rejections, 3)
    assert.equal(probe.passed, true)
    assert.deepEqual(probe.errors, [])
    assert.deepEqual(probe.globals, [
      "Object",
      "Function",
      "Array",
      "Error",
      "Promise",
      "Reflect",
      "Symbol",
      "JSON"
    ])
    assert.equal(typeof probe.versions.node, "string")
    assert.ok(Array.isArray(item.applicationEvidence) && item.applicationEvidence.length > 0)
    const evidence: unknown[] = item.applicationEvidence
    assert.ok(
      evidence.some(
        (entry) => object(entry) && typeof entry.factories === "number" && entry.factories > 0
      ),
      "Consumer build did not use the fork"
    )
    for (const entry of evidence) {
      assert.ok(object(entry))
      assert.equal(entry.nonce, item.nonce)
      assert.equal(entry.loader, item.loader)
      assert.equal(entry.globalsPreserved, true)
      assert.equal(entry.exitCode, 0)
    }
  }
  assert.equal(phases.size, 3, "Duplicate real-host cache phases")
}

type HarnessOptions = {
  nonce: string
  files: FileTree
  sdk: string
  onEvent?: (value: Record<string, unknown>) => void
}
export async function createWebContainerHarness(
  options: HarnessOptions
): Promise<{ url: string; result: Promise<unknown>; close: () => Promise<void> }> {
  const assets = new Map<string, Buffer>()
  function add(directory: string, prefix: string): void {
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name),
        info = lstatSync(file)
      assert.ok(!info.isSymbolicLink(), "SDK contains a symlink")
      if (info.isDirectory()) add(file, prefix + name + "/")
      else {
        assert.ok(info.isFile())
        assets.set(prefix + name, readFileSync(file))
      }
    }
  }
  add(realpathSync(options.sdk), "/sdk/")
  let complete: (value: unknown) => void = () => {}
  const result = new Promise<unknown>((resolve) => {
    complete = resolve
  })
  let received = false
  const server = createServer((request, response) => {
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin")
    response.setHeader("Cross-Origin-Embedder-Policy", "credentialless")
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin")
    response.setHeader("Cache-Control", "no-store")
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname
    if (request.method === "GET") {
      if (pathname === "/") {
        response.setHeader("Content-Type", "text/html; charset=utf-8")
        response.end(
          '<!doctype html><meta charset="utf-8"><title>esm-sync #917 verification</title><script type="module" src="/run.mjs"></script>'
        )
        return
      }
      if (pathname === "/run.mjs") {
        response.setHeader("Content-Type", "text/javascript; charset=utf-8")
        response.end(webContainerBrowserPage(options.nonce))
        return
      }
      if (pathname === "/files.json") {
        response.setHeader("Content-Type", "application/json")
        response.end(JSON.stringify(options.files))
        return
      }
      const asset = assets.get(pathname)
      if (asset) {
        response.setHeader(
          "Content-Type",
          pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "application/octet-stream"
        )
        response.end(asset)
        return
      }
    }
    if (request.method !== "POST" || !["/event", "/result"].includes(pathname)) {
      response.writeHead(404).end()
      return
    }
    void (async () => {
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of request as AsyncIterable<Buffer>) {
        const buffer = Buffer.from(chunk)
        length += buffer.length
        assert.ok(length <= 8 * 1024 * 1024, "Browser report exceeds size limit")
        chunks.push(buffer)
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      if (!object(value) || value.nonce !== options.nonce) {
        response.writeHead(403).end()
        return
      }
      if (pathname === "/event") options.onEvent?.(value)
      else if (!received) {
        received = true
        complete(value)
      } else {
        response.writeHead(409).end()
        return
      }
      response.writeHead(204).end()
    })().catch(() => {
      if (!response.headersSent) response.writeHead(400).end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve()
    })
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  return {
    url: `http://localhost:${address.port}/`,
    result,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
}

export async function verifyWebContainerBrowser(
  reportDirectory: string,
  options: { browser?: string; timeout?: number } = {}
): Promise<Record<string, unknown>> {
  mkdirSync(reportDirectory, { recursive: true })
  const reports = realpathSync(reportDirectory)
  const temporary = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-webcontainer-browser-")))
  const kit = exportWebContainerKit(temporary)
  const nonce = process.env.ESM_WEB_NONCE ?? randomUUID()
  const loaderSHA256 = createHash("sha256")
    .update(readFileSync(path.join(root, "dist/esm/loader.js")))
    .digest("hex")
  const browser = options.browser ?? process.env.ESM_CHROMIUM_EXECUTABLE ?? "chromium"
  const version = spawnSync(browser, ["--version"], { encoding: "utf8", timeout: 10_000 })
  const report: Record<string, unknown> = {
    issue: 917,
    scope: "actual-webcontainer-application",
    reproduction: "reconstructed-consumer",
    nonce,
    loaderSHA256,
    sdkVersion: "1.6.4",
    sdkSHA256: hostWebContainerSdk.sha256,
    browserVersion: version.stdout?.trim() ?? "",
    passed: false,
    blocked: true,
    booted: false
  }
  const output = path.join(reports, "report.json"),
    events: Record<string, unknown>[] = []
  let child: ReturnType<typeof spawn> | undefined,
    harness: Awaited<ReturnType<typeof createWebContainerHarness>> | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    force: ReturnType<typeof setTimeout> | undefined
  let stderr = "",
    finished = false,
    stage = "startup"
  function stop(): void {
    if (!child?.pid) return
    try {
      if (process.platform === "win32") child.kill("SIGTERM")
      else process.kill(-child.pid, "SIGTERM")
    } catch (error) {
      if (!object(error) || error.code !== "ESRCH") throw error
    }
  }
  const interrupted = () => {
    report.error = "Browser verification interrupted"
    stop()
  }
  process.once("SIGINT", interrupted)
  process.once("SIGTERM", interrupted)
  try {
    assert.equal(version.status, 0, version.error?.message ?? version.stderr)
    const sdk = path.join(root, ".cache/webcontainer-sdk")
    const manifest = JSON.parse(readFileSync(path.join(sdk, "package.json"), "utf8")) as {
      name: string
      version: string
    }
    assert.equal(manifest.name, "@webcontainer/api")
    assert.equal(manifest.version, "1.6.4")
    harness = await createWebContainerHarness({
      nonce,
      files: webContainerFileTree(kit.directory),
      sdk,
      onEvent: (value) => {
        events.push(value)
        if (typeof value.stage === "string") stage = value.stage
        if (value.type === "output" && typeof value.message === "string")
          process.stdout.write(value.message)
        else if (typeof value.message === "string")
          console.log(`${hostLabel("cyan", "WEB")} #917 ${value.message}`)
      }
    })
    const profile = path.join(temporary, "chromium-profile")
    mkdirSync(profile)
    const args = [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      `--user-data-dir=${realpathSync(profile)}`
    ]
    const configuredProxy =
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy
    if (configuredProxy) {
      const proxy = new URL(configuredProxy)
      assert.ok(
        !proxy.username && !proxy.password,
        "Chromium command-line proxies cannot include credentials"
      )
      args.push("--proxy-server=" + proxy.origin)
    }
    args.push(harness.url)
    let failed: (error: Error) => void = () => {}
    const browserFailure = new Promise<never>((_resolve, reject) => {
      failed = reject
    })
    child = spawn(browser, args, {
      stdio: ["ignore", "ignore", "pipe"],
      detached: process.platform !== "win32"
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-1000000)
    })
    child.once("error", (error) => failed(new Error("Chromium could not start: " + error.message)))
    child.once("close", (code, signal) => {
      if (!finished)
        failed(new Error(`Chromium exited before verification (code ${code}, signal ${signal})`))
    })
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Real WebContainer verification timed out during ${stage}`)),
        options.timeout ?? 240_000
      )
    })
    const payload = await Promise.race([harness.result, browserFailure, deadline])
    assert.ok(object(payload))
    Object.assign(report, payload, {
      issue: 917,
      scope: "actual-webcontainer-application",
      nonce,
      loaderSHA256,
      sdkVersion: "1.6.4",
      sdkSHA256: hostWebContainerSdk.sha256,
      browserVersion: version.stdout.trim()
    })
    assert.equal(typeof report.passed, "boolean")
    assert.equal(typeof report.blocked, "boolean")
    if (report.passed === true) validateWebContainerBrowserReport(report, { nonce, loaderSHA256 })
  } catch (error) {
    report.passed = false
    report.blocked = !["spawn", "run", "collect", "complete"].includes(stage)
    report.error = hostFailureText(error)
    report.stage = stage
  } finally {
    finished = true
    clearTimeout(timer)
    if (child?.pid) {
      stop()
      force = setTimeout(() => {
        try {
          if (process.platform === "win32") child?.kill("SIGKILL")
          else if (child?.pid) process.kill(-child.pid, "SIGKILL")
        } catch {}
      }, 1000)
      force.unref()
    }
    await harness?.close()
    process.removeListener("SIGINT", interrupted)
    process.removeListener("SIGTERM", interrupted)
    writeFileSync(path.join(reports, "browser.log"), stderr)
    writeFileSync(path.join(reports, "events.json"), JSON.stringify(events, null, 2))
    if (object(report.artifacts))
      for (const [name, value] of Object.entries(report.artifacts))
        if (typeof value === "string" && path.basename(name) === name && /\.(json|log)$/.test(name))
          writeFileSync(
            path.join(reports, name === "report.json" ? "worker-report.json" : name),
            value
          )
    writeFileSync(
      path.join(reports, "worker.log"),
      typeof report.output === "string" ? report.output : ""
    )
    writeFileSync(output, JSON.stringify(report, null, 2))
  }
  console.log(
    `\n${hostLabel(report.passed ? "green" : report.blocked ? "yellow" : "red", report.passed ? "PASS" : report.blocked ? "BLOCKED" : "FAIL")} #917 real WebContainer${report.passed ? " — module graph + consumer builds in all cache modes" : ` during ${String(report.stage ?? stage)}: ${hostFailureText(report.error ?? "Worker evidence did not pass; see reports")}`}\nREPORT ${output}`
  )
  return report
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  verifyWebContainerBrowser("/reports")
    .then((report) => {
      process.exitCode = report.passed ? 0 : report.blocked ? 2 : 1
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exitCode = 1
    })
}
