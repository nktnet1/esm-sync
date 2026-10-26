"use strict"

import { fork, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseArgs, stripVTControlCharacters, styleText } from "node:util"
import execa from "execa"
import packageInfo from "../../package.json"
import {
  compatibilityChecks,
  consumerFormats,
  runInstalledPackageCheck,
  verifyInstalledFiles,
  type ConsumerFormat
} from "./package-smoke.js"
import { createPublishManifest } from "./package-manifest.js"

const verdaccioVersion = "6.10.4"
const root = path.resolve(__dirname, "../..")
let activeStage = "initialisation"
let stageNumber = 0
let stageTotal = 0
let sectionNumber = 0
let verboseStages = false
let failedStage: string | undefined

type CheckResults = Map<string, boolean>

function formatName(format: ConsumerFormat): string {
  return styleText(format === "cjs" ? "magenta" : "yellow", format.toUpperCase())
}

function section(title: string, detail?: string): void {
  console.log(
    `\n  ${styleText("blue", String(++sectionNumber).padStart(2, "0"))}  ${title}${detail ? `  ${styleText("dim", detail)}` : ""}`
  )
  console.log(`  ${"-".repeat(73)}`)
}

async function stage<T>(label: string, description: string, action: () => Promise<T>): Promise<T> {
  activeStage = `${label}: ${stripVTControlCharacters(description)}`
  const number = `[${String(++stageNumber).padStart(2, "0")}/${stageTotal}]`
  const category =
    label === "CJS" || label === "ESM"
      ? formatName(label.toLowerCase() as ConsumerFormat)
      : styleText(label === "CLEANUP" ? "yellow" : "cyan", label)
  const prefix = `    ${styleText("dim", number)}  ${category}${" ".repeat(Math.max(2, 11 - label.length))}${description}`
  const line = `${prefix}${" ".repeat(Math.max(2, 87 - stripVTControlCharacters(prefix).length))}`
  if (verboseStages) console.log(prefix)
  else process.stdout.write(line)
  const start = Date.now()
  try {
    const result = await action()
    const status = `${styleText(["bold", "green"], "PASS")}  ${styleText("dim", `${((Date.now() - start) / 1000).toFixed(1)}s`)}`
    console.log(verboseStages ? `            ${status}` : status)
    return result
  } catch (error) {
    failedStage ??= activeStage
    const status = `${styleText(["bold", "red"], "FAIL")}  ${styleText("dim", `${((Date.now() - start) / 1000).toFixed(1)}s`)}`
    console.log(verboseStages ? `            ${status}` : status)
    throw error
  }
}

function displayResults(
  formats: readonly ConsumerFormat[],
  results: CheckResults,
  success: boolean,
  workerRounds: number
) {
  section(styleText(["bold", "cyan"], "RESULTS"))
  let importsPassed = 0
  let importsTotal = 0
  for (const format of formats) {
    for (const target of ["cjs", "esm", ...(format === "cjs" ? ["preload"] : [])] as Array<
      ConsumerFormat | "preload"
    >) {
      const name =
        target === "preload"
          ? `${formatName(format)} project: CLI preload`
          : `${formatName(format)} project importing ${formatName(target)} module`
      const status = results.get(`${format}:${target}`)
      if (target !== "preload") {
        if (status === true) importsPassed++
        importsTotal++
      }
      const label =
        status === true
          ? styleText(["bold", "green"], "PASS")
          : status === false
            ? styleText(["bold", "red"], "FAIL")
            : styleText("yellow", "NOT RUN")
      const gap = " ".repeat(Math.max(2, 50 - stripVTControlCharacters(name).length))
      console.log(`    ${name}${gap}${label}`)
    }
  }
  console.log(`\n    ${styleText(["bold", "blue"], "ADDITIONAL COMPATIBILITY")}`)
  let advancedPassed = 0
  let advancedTotal = 0
  for (const format of formats) {
    for (const check of compatibilityChecks) {
      const name = `${formatName(format)}  ${check.label}`
      const status = results.get(`${format}:${check.id}`)
      advancedTotal++
      if (status === true) advancedPassed++
      const label =
        status === true
          ? styleText(["bold", "green"], "PASS")
          : status === false
            ? styleText(["bold", "red"], "FAIL")
            : styleText("yellow", "NOT RUN")
      const gap = " ".repeat(Math.max(2, 75 - stripVTControlCharacters(name).length))
      console.log(`    ${name}${gap}${label}`)
    }
  }
  const preload = formats.includes("cjs") ? results.get("cjs:preload") : undefined
  const preloadLabel =
    preload === true
      ? styleText(["bold", "green"], "PASS")
      : preload === false
        ? styleText(["bold", "red"], "FAIL")
        : styleText("yellow", "NOT RUN")
  console.log(
    `\n  ${styleText(["bold", success ? "green" : "red"], success ? "PASS" : "FAIL")}  ${styleText("cyan", `${importsPassed}/${importsTotal}`)} import pairs  |  ${styleText("cyan", `${advancedPassed}/${advancedTotal}`)} compatibility checks${formats.includes("cjs") ? `  |  CJS preload ${preloadLabel}` : ""}`
  )
  if (workerRounds > 1)
    console.log(`  ${styleText("yellow", "WORKER STRESS")}  ${workerRounds} rounds per project`)
  console.log(
    `  ${success ? "Published package verified in isolated projects" : `Stopped at ${failedStage ?? activeStage}`}.\n`
  )
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

async function testRegistry(
  formats: readonly ConsumerFormat[],
  verbose: boolean,
  results: CheckResults,
  workerRounds: number
): Promise<void> {
  stageTotal =
    9 +
    formats.reduce(
      (total, format) => total + compatibilityChecks.length + (format === "cjs" ? 7 : 6),
      0
    )
  verboseStages = verbose
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
      // Default to stage summaries. --verbose streams the child tools' output.
      // execa includes captured stdout/stderr in errors when a command fails.
      stdio: verbose ? ("inherit" as const) : ("pipe" as const),
      timeout: 180_000
    }
    section(styleText(["bold", "cyan"], "PACKAGE & REGISTRY"), "Prepare, pack, and publish")
    await stage("FIXTURES", "Prepare Acorn source", async () => {
      await execa(process.execPath, [path.join(__dirname, "setup-fixtures.js"), "acorn"], {
        ...command,
        cwd: root
      })
    })
    await stage(
      "BUILD",
      `Compile ${packageInfo.name}@${packageInfo.version} for production`,
      async () => {
        await execa(process.execPath, [path.join(__dirname, "build.js"), "--prod"], {
          ...command,
          cwd: root
        })
      }
    )

    await stage("REGISTRY", `Install temporary Verdaccio ${verdaccioVersion}`, async () => {
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
    })
    const registry = await stage("REGISTRY", "Start local registry", async () => {
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
          if (verbose) process.stderr.write(chunk)
        })
      }
      return registryReady(child)
    })
    console.log(`    ${styleText("blue", "REGISTRY")}  ${styleText("cyan", registry)}`)

    await stage("AUTH", "Create temporary publisher credentials", async () => {
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
    })

    const tarball = path.join(temporary, "esm-sync.tgz")
    const packageRoot = path.join(temporary, "package")
    await stage("PACK", "Stage publish files and create package tarball", async () => {
      // The build lets tsdown update exports in package.json. Publish that
      // result, not the JSON imported before the build started.
      const builtPackageInfo: typeof packageInfo = JSON.parse(
        await fs.readFile(path.join(root, "package.json"), "utf8")
      )
      const filenames = new Set(["LICENSE", "README.md"])
      for await (const filename of fs.glob(builtPackageInfo.files, { cwd: root }))
        filenames.add(filename)
      for (const filename of filenames) {
        const target = path.join(packageRoot, filename)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.cp(path.join(root, filename), target, { recursive: true })
      }
      await fs.writeFile(
        path.join(packageRoot, "package.json"),
        JSON.stringify(createPublishManifest(builtPackageInfo), null, 2) + "\n"
      )
      await execa("pnpm", ["pack", "--ignore-scripts", "--out", tarball], {
        ...command,
        cwd: packageRoot
      })
    })
    await stage(
      "PUBLISH",
      `Publish ${packageInfo.name}@${packageInfo.version} to Verdaccio`,
      async () => {
        await execa(
          "npm",
          ["publish", tarball, "--ignore-scripts", "--registry", registry, "--tag", "smoke"],
          command
        )
      }
    )
    await stage("VERIFY", "Check published package metadata", async () => {
      const response = await fetch(
        `${registry}/${encodeURIComponent(packageInfo.name)}/${packageInfo.version}`,
        { signal: AbortSignal.timeout(10_000) }
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
    })

    for (const format of formats) {
      const label = format.toUpperCase()
      const consumer = path.join(temporary, `consumer-${format}`)
      section(
        `${formatName(format)} ${styleText("bold", "PROJECT")}`,
        `type: "${format === "cjs" ? "commonjs" : "module"}"`
      )
      await stage(
        label,
        `Create ${format === "cjs" ? "CommonJS" : "ESM"} consumer project`,
        async () => {
          await fs.cp(path.join(root, "test/packed"), consumer, { recursive: true })
          await fs.writeFile(
            path.join(consumer, "project.js"),
            format === "cjs"
              ? '"use strict"; module.exports = { format: "commonjs" }\n'
              : 'export default { format: "module" }\n'
          )
          await fs.writeFile(
            path.join(consumer, "package.json"),
            JSON.stringify({
              name: `esm-sync-registry-consumer-${format}`,
              private: true,
              type: format === "cjs" ? "commonjs" : "module",
              allowScripts: { [packageInfo.name]: true }
            })
          )
        }
      )
      await stage(label, "Install published package and run lifecycle scripts", async () => {
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
      })
      const installed = path.join(consumer, "node_modules", packageInfo.name)
      const binary = `dist/native/${process.platform}-${process.arch}-${process.versions.modules}.node`
      await stage(label, "Rebuild the installed native addon", async () => {
        await fs.rm(path.join(installed, binary))
        await execa(process.execPath, ["dist/script/build-sync-await.js", "--required"], {
          ...command,
          cwd: installed
        })
      })
      await stage("VERIFY", "Check installed package files", async () => {
        await verifyInstalledFiles(consumer)
      })
      console.log(
        `\n    ${styleText(["bold", "blue"], "IMPORT TESTS")}  ${styleText("dim", "Separate Node processes")}`
      )
      for (const target of ["cjs", "esm"] as const) {
        const name = `${formatName(format)} project importing ${formatName(target)} module`
        const key = `${format}:${target}`
        try {
          await stage("TEST", name, () =>
            runInstalledPackageCheck(consumer, format, target, verbose)
          )
          results.set(key, true)
        } catch (error) {
          results.set(key, false)
          throw error
        }
      }
      console.log(
        `\n    ${styleText(["bold", "blue"], "ADDITIONAL COMPATIBILITY")}  ${styleText("dim", "Separate Node processes")}`
      )
      for (const check of compatibilityChecks) {
        const key = `${format}:${check.id}`
        try {
          await stage(
            "CHECK",
            check.id === "workers" && workerRounds > 1
              ? `${check.label} (${workerRounds} rounds)`
              : check.label,
            () => runInstalledPackageCheck(consumer, format, check.id, verbose, workerRounds)
          )
          results.set(key, true)
        } catch (error) {
          results.set(key, false)
          throw error
        }
      }
      if (format === "cjs") {
        try {
          await stage("PRELOAD", `${formatName(format)} project: CLI preload`, () =>
            runInstalledPackageCheck(consumer, format, "preload", verbose)
          )
          results.set("cjs:preload", true)
        } catch (error) {
          results.set("cjs:preload", false)
          throw error
        }
      }
    }
  } catch (error) {
    if (registryLog)
      console.error(`\n${styleText("yellow", "Registry log")} (last 16 KB):\n${registryLog}`)
    throw error
  } finally {
    section(styleText(["bold", "cyan"], "CLEANUP"), "Remove temporary registry and consumers")
    await stage("CLEANUP", "Stop Verdaccio and remove temporary workspace", async () => {
      try {
        await stopRegistry(child)
      } finally {
        await fs.rm(temporary, { recursive: true, force: true })
      }
    })
  }
}

export async function runRegistryTest(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      format: { type: "string", default: "both" },
      verbose: { type: "boolean", default: false },
      "worker-rounds": { type: "string", default: "1" }
    }
  })
  const formats = consumerFormats(values.format ?? "both")
  const workerRounds = Number(values["worker-rounds"])
  if (!Number.isSafeInteger(workerRounds) || workerRounds < 1 || workerRounds > 50)
    throw new Error("--worker-rounds must be an integer between 1 and 50")
  activeStage = "initialisation"
  failedStage = undefined
  stageNumber = 0
  sectionNumber = 0
  const scope = formats.map((format) => format.toUpperCase()).join(" + ")
  console.log(
    `\n  ${styleText(["bold", "cyan"], "VERDACCIO")}  ${styleText(["bold", "magenta"], `${packageInfo.name}@${packageInfo.version}`)}`
  )
  console.log(
    `  Publish and install smoke tests  ${styleText("dim", `Node ${process.version}  |  ${scope}${workerRounds > 1 ? `  |  ${workerRounds} worker rounds` : ""}${values.verbose ? "  |  verbose" : ""}`)}`
  )
  const results: CheckResults = new Map()
  let complete = false
  process.once("exit", (code) => {
    if (!complete) {
      console.error(`${styleText("red", "FAIL")} incomplete run after ${activeStage}`)
      if (code === 0) process.exitCode = 1
    }
  })
  try {
    await testRegistry(formats, values.verbose ?? false, results, workerRounds)
    complete = true
    displayResults(formats, results, true, workerRounds)
  } catch (error) {
    complete = true
    displayResults(formats, results, false, workerRounds)
    throw error
  }
}

if (require.main === module) {
  runRegistryTest().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
