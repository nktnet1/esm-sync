import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { parseArgs, styleText } from "node:util"

const root = path.resolve(path.dirname(realpathSync(process.argv[1]!)), "../..")
const { values } = parseArgs({
  options: {
    project: { type: "string" },
    node: { type: "string", default: process.execPath },
    json: { type: "boolean", default: false }
  }
})
assert.ok(values.project, "--project must point to the installed original #810 reproduction")
const project = realpathSync(values.project)
const executable = realpathSync(values.node)
const register = realpathSync(
  createRequire(path.join(project, "package.json")).resolve("@babel/register")
)
const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-sync-babel-repro-")))
const observedFiles = [
  ".babelrc",
  "package.json",
  "src/index.js",
  "src/app.js",
  "src/router.js",
  "src/database.js",
  "src/routes/hello-world.route.js"
]
function sourceHashes(base = project) {
  return Object.fromEntries(
    observedFiles.map((filename) => [
      filename,
      createHash("sha256")
        .update(readFileSync(path.join(base, filename)))
        .digest("hex")
    ])
  )
}
const before = sourceHashes()
const observer = path.join(directory, "observe.cjs")
writeFileSync(
  observer,
  `
const assert = require('node:assert/strict')
const http = require('node:http')
const database = process.env.REPRO_DATABASE
const timeout = global.setTimeout
let scheduled = 0
let completed = 0
global.setTimeout = function(callback, delay, ...args) {
  if (delay !== 2000 || !new Error().stack.includes(database)) return timeout(callback, delay, ...args)
  scheduled++
  return timeout(function(...values) {
    callback(...values)
    // The original database ends with its await. This microtask runs after
    // the timer resolves that await, without editing or transforming its source.
    queueMicrotask(() => completed++)
  }, delay, ...args)
}
const listen = http.Server.prototype.listen
http.Server.prototype.listen = function(...args) {
  assert.equal(scheduled, 1, 'database must evaluate exactly once before listen')
  assert.equal(completed, 1, 'database initialization must finish before listen')
  this.once('listening', () => {
    http.get({host:'127.0.0.1',port:this.address().port,path:'/'}, response => {
      let body = ''
      response.setEncoding('utf8').on('data',chunk => body += chunk)
      response.on('end', () => {
        assert.equal(response.statusCode, 200)
        assert.equal(body, 'Hello world')
        assert.equal(scheduled, 1)
        assert.equal(completed, 1)
        console.log('issue-810:verified')
        this.close()
      })
    }).on('error', error => { throw error })
  })
  return Reflect.apply(listen, this, args)
}
`
)

try {
  const samples: {
    entry: string
    order: string
    cache: string
    status: number | null
    stdout: string
    stderr: string
  }[] = []
  // Each entry/order has an independent bootstrap, compiler, and Babel cache.
  // A separate disabled-cache run also excludes stale bootstrap bytecode.
  for (const entry of ["esm.js", "index.js", "dist/esm.js", "dist/index.js"]) {
    for (const order of ["loader-first", "babel-first"]) {
      const staging = path.join(directory, entry.replaceAll("/", "-"), order)
      mkdirSync(staging, { recursive: true })
      for (const file of [
        "package.json",
        "esm.js",
        "index.js",
        "dist/esm.js",
        "dist/index.js",
        "dist/esm/loader.js"
      ]) {
        const target = path.join(staging, file)
        mkdirSync(path.dirname(target), { recursive: true })
        cpSync(path.join(root, file), target)
      }
      if (existsSync(path.join(root, "dist/native")))
        cpSync(path.join(root, "dist/native"), path.join(staging, "dist/native"), {
          recursive: true
        })
      // Preserve the original files byte-for-byte while giving their package
      // configuration (including its own cache defaults) a private workspace.
      const workingProject = path.join(staging, "application")
      for (const filename of observedFiles) {
        const target = path.join(workingProject, filename)
        mkdirSync(path.dirname(target), { recursive: true })
        cpSync(path.join(project, filename), target)
      }
      const modules = path.join(workingProject, "node_modules")
      mkdirSync(modules)
      for (const name of readdirSync(path.join(project, "node_modules"))) {
        if (name.startsWith(".")) continue
        symlinkSync(
          realpathSync(path.join(project, "node_modules", name)),
          path.join(modules, name),
          "junction"
        )
      }
      const database = realpathSync(path.join(workingProject, "src/database.js"))
      const loader = path.join(staging, entry)
      const preloads = order === "loader-first" ? [loader, register] : [register, loader]
      for (const cache of ["disabled", "cold", "warm"]) {
        const compilerCache = path.join(modules, ".cache/esm/.data.json")
        const bootstrapCache = path.join(staging, "node_modules/.cache/esm/.data.json")
        assert.equal(existsSync(compilerCache), cache === "warm", "Unexpected compiler-cache state")
        assert.equal(
          existsSync(bootstrapCache),
          cache === "warm",
          "Unexpected bootstrap-cache state"
        )
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          NODE_OPTIONS: "",
          NODE_ENV: "production",
          NODE_USE_ENV_PROXY: "0",
          PORT: "0",
          REPRO_DATABASE: database,
          BABEL_CACHE_PATH: path.join(staging, "babel-cache.json"),
          ESM_OPTIONS: JSON.stringify({ cache: path.join(staging, "compiler-cache") })
        }
        if (cache === "disabled")
          Object.assign(env, { ESM_DISABLE_CACHE: "true", BABEL_DISABLE_CACHE: "1" })
        else {
          delete env.ESM_DISABLE_CACHE
          delete env.BABEL_DISABLE_CACHE
        }
        const result = spawnSync(
          executable,
          ["-r", observer, ...preloads.flatMap((filename) => ["-r", filename]), "src/index.js"],
          { cwd: workingProject, env, encoding: "utf8", timeout: 30_000 }
        )
        const sample = {
          entry,
          order,
          cache,
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr
        }
        samples.push(sample)
        assert.equal(
          result.status,
          0,
          `${entry}, ${order}, ${cache}: ${result.error?.message ?? result.stderr}`
        )
        assert.ok(result.stdout.includes("issue-810:verified"), JSON.stringify(sample))
        if (cache !== "disabled") {
          assert.ok(existsSync(compilerCache), "No persistent compiler cache")
          assert.ok(existsSync(bootstrapCache), "No persistent bootstrap cache")
        } else {
          assert.ok(
            !existsSync(compilerCache) && !existsSync(bootstrapCache),
            "Disabled caches were written"
          )
        }
        if (!values.json) console.log(`${styleText("green", "PASS")} ${entry} ${order} ${cache}`)
      }
      assert.deepEqual(sourceHashes(workingProject), before, "Working reproduction sources changed")
    }
  }
  assert.deepEqual(sourceHashes(), before, "Original reproduction sources changed")
  const report = {
    project,
    node: spawnSync(executable, ["--version"], { encoding: "utf8" }).stdout.trim(),
    runtimeSHA256: createHash("sha256")
      .update(readFileSync(path.join(root, "dist/esm/loader.js")))
      .digest("hex"),
    unchangedSourceSHA256: before,
    samples
  }
  if (values.json) console.log(JSON.stringify(report))
} finally {
  rmSync(directory, { recursive: true, force: true })
}
