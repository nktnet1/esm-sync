"use strict"

import { fork, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseArgs, styleText } from "node:util"
import execa from "execa"
import packageInfo from "../../package.json"
import { consumerFormats, verifyInstalledPackage, type ConsumerFormat } from "./package-smoke.js"
import { createPublishManifest } from "./package-manifest.js"

const verdaccioVersion = "6.10.4"
const root = path.resolve(__dirname, "../..")
let activeStage = "setup"
const stage = (message: string, value: string) => {
  activeStage = `${message} ${value}`
  console.log(`[verdaccio] ${message} ${styleText("cyan", value)}`)
}

function registryReady(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Verdaccio startup timed out")), 120_000)
    function finish(error?: Error, port?: number) {
      clearTimeout(timer)
      child.off("error", onError)
      child.off("exit", onExit)
      child.off("message", onMessage)
      if (error) reject(error)
      else resolve(`http://127.0.0.1:${port}`)
    }
    function onError(error: Error) {
      finish(error)
    }
    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      finish(new Error(`Verdaccio exited before startup (${signal ?? code})`))
    }
    function onMessage(message: unknown) {
      if (
        typeof message === "object" &&
        message !== null &&
        "port" in message &&
        typeof message.port === "number" &&
        Number.isInteger(message.port) &&
        message.port > 0 &&
        message.port < 65536
      )
        finish(undefined, message.port)
    }
    child.once("error", onError)
    child.once("exit", onExit)
    child.on("message", onMessage)
  })
}

async function stopRegistry(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()))
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
  child.kill("SIGTERM")
  try {
    await closed
  } finally {
    clearTimeout(timer)
  }
}

async function testRegistry(formats: readonly ConsumerFormat[]): Promise<void> {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "esm-sync-registry-"))
  const registryRoot = path.join(temporary, "registry")
  const npmrc = path.join(temporary, ".npmrc")
  const globalNpmrc = path.join(temporary, "global.npmrc")
  const configPath = path.join(registryRoot, "config.json")
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Keep the registry test independent of the caller's npm credentials/config.
  for (const key of Object.keys(env)) {
    if (/^npm_config_/i.test(key) || key === "NPM_TOKEN" || key === "NODE_AUTH_TOKEN")
      delete env[key]
  }
  Object.assign(env, {
    NODE_ENV: "production",
    PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? ""),
    NPM_CONFIG_USERCONFIG: npmrc,
    NPM_CONFIG_GLOBALCONFIG: globalNpmrc,
    NPM_CONFIG_CACHE: path.join(temporary, "npm-cache"),
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NO_PROXY: [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",")
  })
  for (const key of [
    "ESM_ENV",
    "ESM_OPTIONS",
    "ESM_DISABLE_CACHE",
    "ESM_SYNC_TEST_BUILD",
    "NODE_PATH",
    "NODE_OPTIONS"
  ])
    delete env[key]
  let child: ChildProcess | undefined
  let registryLog = ""

  try {
    await fs.mkdir(registryRoot, { recursive: true })
    await fs.writeFile(npmrc, "")
    await fs.writeFile(globalNpmrc, "")
    const command = {
      cwd: temporary,
      env,
      extendEnv: false,
      stdio: "inherit" as const,
      timeout: 180_000
    }
    stage("Building production package", `${packageInfo.name}@${packageInfo.version}`)
    await execa(process.execPath, [path.join(__dirname, "setup-fixtures.js"), "acorn"], {
      ...command,
      cwd: root
    })
    await execa(process.execPath, [path.join(__dirname, "build.js"), "--prod"], {
      ...command,
      cwd: root
    })

    stage("Preparing disposable registry", `Verdaccio ${verdaccioVersion}`)
    await fs.writeFile(
      path.join(registryRoot, "package.json"),
      JSON.stringify({ name: "esm-sync-registry-harness", private: true })
    )
    await execa(
      "pnpm",
      [
        "--dir",
        registryRoot,
        "add",
        "--save-exact",
        "--ignore-scripts",
        `verdaccio@${verdaccioVersion}`,
        "--registry=https://registry.npmjs.org"
      ],
      command
    )
    await fs.writeFile(
      configPath,
      JSON.stringify({
        storage: path.join(registryRoot, "storage"),
        auth: { htpasswd: { file: path.join(registryRoot, "htpasswd"), max_users: 10 } },
        uplinks: { npmjs: { url: "https://registry.npmjs.org/" } },
        packages: {
          [packageInfo.name]: { access: "$all", publish: "$authenticated" },
          "**": { access: "$all", proxy: "npmjs" }
        },
        log: { type: "stdout", format: "pretty", level: "warn" }
      })
    )
    const serverPath = path.join(registryRoot, "server.cjs")
    await fs.writeFile(
      serverPath,
      `const { runServer } = require('verdaccio')
runServer(process.argv[2]).then((app) => {
  const server = app.listen(0, '127.0.0.1', () => {
    process.send({ port: server.address().port })
  })
  const shutdown = () => server.close(() => process.exit(0))
  process.once('SIGTERM', shutdown)
  process.once('disconnect', shutdown)
}).catch((error) => { console.error(error); process.exit(1) })
`
    )
    child = fork(serverPath, [configPath], {
      cwd: registryRoot,
      execPath: process.execPath,
      execArgv: [],
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    })
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding("utf8").on("data", (chunk: string) => {
        registryLog = (registryLog + chunk).slice(-16_000)
      })
    }
    const registry = await registryReady(child)
    stage("Registry ready at", registry)

    const username = "esm-sync-smoke"
    const login = await fetch(`${registry}/-/user/org.couchdb.user:${username}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: username,
        password: randomBytes(24).toString("base64url"),
        email: "smoke@example.invalid",
        type: "user",
        roles: []
      }),
      signal: AbortSignal.timeout(10_000)
    })
    const credentials: unknown = await login.json()
    if (
      !login.ok ||
      typeof credentials !== "object" ||
      credentials === null ||
      !("token" in credentials) ||
      typeof credentials.token !== "string"
    )
      throw new Error(`Unable to authenticate temporary Verdaccio user (${login.status})`)
    await fs.writeFile(
      npmrc,
      `registry=${registry}/\n//${new URL(registry).host}/:_authToken=${credentials.token}\n`
    )
    env.NPM_CONFIG_REGISTRY = registry

    stage("Staging publish files", `${packageInfo.name}@${packageInfo.version}`)
    const tarball = path.join(temporary, "esm-sync.tgz")
    const packageRoot = path.join(temporary, "package")
    const filenames = new Set(["LICENSE", "README.md"])
    for await (const filename of fs.glob(packageInfo.files, { cwd: root })) filenames.add(filename)
    for (const filename of filenames) {
      const target = path.join(packageRoot, filename)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.cp(path.join(root, filename), target, { recursive: true })
    }
    await fs.writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify(createPublishManifest(packageInfo), null, 2) + "\n"
    )
    await execa("pnpm", ["pack", "--ignore-scripts", "--out", tarball], {
      ...command,
      cwd: packageRoot
    })
    stage("Publishing locally", `${packageInfo.name}@${packageInfo.version}`)
    await execa(
      "npm",
      ["publish", tarball, "--ignore-scripts", "--registry", registry, "--tag", "smoke"],
      command
    )
    const response = await fetch(
      `${registry}/${encodeURIComponent(packageInfo.name)}/${packageInfo.version}`,
      {
        signal: AbortSignal.timeout(10_000)
      }
    )
    const metadata: unknown = await response.json()
    if (
      !response.ok ||
      typeof metadata !== "object" ||
      metadata === null ||
      !("version" in metadata) ||
      metadata.version !== packageInfo.version
    )
      throw new Error(`Published package metadata is incorrect (${response.status})`)

    for (const format of formats) {
      const consumer = path.join(temporary, `consumer-${format}`)
      await fs.cp(path.join(root, "test/packed"), consumer, { recursive: true })
      await fs.writeFile(
        path.join(consumer, "package.json"),
        JSON.stringify({
          name: `esm-sync-registry-consumer-${format}`,
          private: true,
          type: format === "cjs" ? "commonjs" : "module",
          allowScripts: { [packageInfo.name]: true }
        })
      )
      stage(`Installing into ${format.toUpperCase()} project from`, registry)
      await execa(
        "npm",
        [
          "install",
          `${packageInfo.name}@${packageInfo.version}`,
          "--registry",
          registry,
          "--ignore-scripts=false",
          "--foreground-scripts",
          "--package-lock=false",
          "--no-audit",
          "--no-fund"
        ],
        { ...command, cwd: consumer }
      )
      const installed = path.join(consumer, "node_modules", packageInfo.name)
      const binary = `dist/native/${process.platform}-${process.arch}-${process.versions.modules}.node`
      await fs.rm(path.join(installed, binary))
      stage(`Rebuilding with the ${format.toUpperCase()} project's production installer`, binary)
      await execa(process.execPath, ["dist/script/build-sync-await.js", "--required"], {
        ...command,
        cwd: installed
      })
      await verifyInstalledPackage(consumer, [format])
    }
  } catch (error) {
    if (registryLog) console.error(`[verdaccio] Registry log:\n${registryLog}`)
    throw error
  } finally {
    await stopRegistry(child)
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

export async function runRegistryTest(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { format: { type: "string", default: "both" } }
  })
  const formats = consumerFormats(values.format ?? "both")
  let complete = false
  process.once("exit", (code) => {
    if (!complete) {
      console.error(`[verdaccio] ${styleText("red", "FAIL")} incomplete run after ${activeStage}`)
      if (code === 0) process.exitCode = 1
    }
  })
  await testRegistry(formats)
  complete = true
  console.log(`[verdaccio] ${styleText("green", "PASS")} publish, install, ${formats.join(" + ")}`)
}

if (require.main === module) {
  runRegistryTest().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
