const { describe, it, before, after, afterEach } = globalThis.__esmSyncNativeTest
import SemVer from "semver"

import assert from "assert"
import execa from "execa"
import fs from "fs-extra"
import path from "path"
import pm2Environment from "./pm2-environment.mjs"

const isTravis = Reflect.has(process.env, "TRAVIS")
const isWin = process.platform === "win32"

const canTestLab = SemVer.satisfies(process.version, ">=7.6")
const canTestPM2 = ! isTravis
// AVA 1 depends on esm@3.2.25, whose old internalModuleStat call causes a
// native assertion abort on these Node versions. Keep the interoperability
// tests enabled on safe Node 22 minors and on Node 24/26.
const canTestAva = ! (
  SemVer.satisfies(process.version, ">=22.10.0 <22.18.0") ||
  SemVer.satisfies(process.version, ">=23.0.0 <24.0.0")
)

const avaPath = path.resolve("../node_modules/ava/cli.js")
const jasminePath = path.resolve("../node_modules/jasmine/bin/jasmine.js")
const jestPath = path.resolve("../node_modules/jest/bin/jest.js")
const labPath = path.resolve("../node_modules/@hapi/lab/bin/lab")
const pkgPath = path.resolve("../index.js")
const nodePath = path.resolve("env/prefix", isWin ? "node.exe" : "bin/node")
const testPath = path.resolve(".")

const defaultNodeArgs = [
  "--no-deprecation"
]

const envAuto = {
  CI: 1,
  ESM_OPTIONS: "{cjs:true,mode:'auto'}"
}

// Third-party CLIs run concurrently and previously reset the parent suite's
// isolated cache to the shared default. Give each invocation its own disk
// cache so V8 cached-data writers cannot race across the scenario tests.
const scenarioCacheRoot = path.resolve("env/native-cache", process.env.ESM_ENV || "default", "scenario")
let scenarioCacheCounter = 0

function exec(filename, args, env) {
  const childEnv = env === envAuto
    ? {
        ...env,
        ESM_OPTIONS: `{cache:${JSON.stringify(path.join(scenarioCacheRoot, `${process.pid}-${++scenarioCacheCounter}`))},${envAuto.ESM_OPTIONS.slice(1)}`
      }
    : env

  return execa(filename, args, {
    cwd: testPath,
    env: childEnv
  })
}

function node(args, env) {
  return exec(nodePath, defaultNodeArgs.concat(args), env)
}

// These tests execute independent CLI processes. Run a few at a time;
// keep the PM2 cases serial because they share a daemon and log directory.
describe("scenario tests", { concurrency: 3 }, () => {

  it("should isolate caches for concurrent external Node processes", () =>
    Promise.all([
      node(["-p", "process.env.ESM_OPTIONS"], envAuto),
      node(["-p", "process.env.ESM_OPTIONS"], envAuto)
    ]).then(([first, second]) => {
      assert.match(first.stdout, /cache:/)
      assert.match(second.stdout, /cache:/)
      assert.notStrictEqual(first.stdout, second.stdout)
    })
  )

  it("should work with dual packages", () =>
    [
      "index.js",
      "index.mjs"
    ]
    .reduce((promise, basename) =>
      promise
        .then(() =>
          node([
            "-r", pkgPath,
            path.resolve("fixture/scenario/dual", basename)
          ])
        )
    , Promise.resolve())
  )

  it("should expose babel errors", () =>
    node([
      "-r", pkgPath,
      "-r", "@babel/register",
      path.resolve("fixture/scenario/babel-error-runner.cjs")
    ])
    .then(
      () => assert.fail("Babel compilation unexpectedly succeeded"),
      ({ exitCode, stderr }) => {
        // Preserve useful CI diagnostics without printing a massive bundled stack.
        const diagnostic = stderr.length > 8192
          ? `${stderr.slice(0, 4096)}\n[... truncated ...]\n${stderr.slice(-4096)}`
          : stderr

        assert.strictEqual(exitCode, 1, diagnostic)
        assert.match(stderr, /(?:^|\n)babel-error:[^\n]*\bBABEL_ERROR\b/, diagnostic)
      }
    )
  )

  it("should work with esmod-pmb", () =>
    node([
      path.resolve("fixture/scenario/esmod-pmb/test.node.js")
    ])
  )

  it("should work with express", () =>
    node([
      path.resolve("fixture/scenario/express/index.js")
    ])
    .then(({ stdout }) => assert.ok(stdout.includes("express:true")))
  )

  it("should work with global-prefix", () =>
    node([
      path.resolve("fixture/scenario/global-prefix/index.js")
    ])
    .then(({ stdout }) => assert.ok(stdout.includes("global-prefix:true")))
  )

  it("should work with jasmine", () => {
    const dirPath = path.resolve("fixture/scenario/jasmine-helpers")
    const configPath = path.resolve(dirPath, "jasmine.json")
    const cwdPath = path.resolve(dirPath, "cwd.js")

    return node([
      "-r", cwdPath,
      jasminePath, "--config=" + configPath
    ], envAuto)
  })

  it("should work with lit-node", () =>
    node([
      "-r", pkgPath,
      "-r", "lit-node/register",
      path.resolve("fixture/scenario/lit-node")
    ], envAuto)
    .then(({ stdout }) => assert.ok(stdout.includes("lit-node:true")))
  )

  it("should work with mocha", () =>
    exec("mocha", [
      "-r", pkgPath,
      path.resolve("fixture/scenario/mocha")
    ], envAuto)
    .then(({ stdout }) => assert.ok(stdout.includes("mocha:true")))
  )

  it("should work with module-alias", () =>
    node([
      path.resolve("fixture/scenario/module-alias")
    ])
    .then(({ stdout }) => assert.ok(stdout.includes("module-alias:true")))
  )

  it("should work with native modules", () =>
    node([
      "-r", pkgPath,
      path.resolve("fixture/scenario/native")
    ], envAuto)
    .then(({ stdout, stderr }) => {
      assert.strictEqual(stderr, "")
      assert.ok(stdout.includes("native:true"))
    })
  )

  it("should work with newrelic", () => {
    const dirPath = path.resolve("fixture/scenario/newrelic")
    const cwdPath = path.resolve(dirPath, "cwd.js")
    const filename = path.resolve(dirPath, "index.js")

    return node([
      "-r", pkgPath,
      "-r", cwdPath,
      "-r", "newrelic",
      filename
    ])
  })

  it("should work with nyc", () => {
    const dirPath = path.resolve("fixture/scenario/nyc")
    const filename = path.resolve(dirPath, "index.js")

    return exec("nyc", [
      "--cwd", dirPath,
      "-i", pkgPath,
      nodePath, ...defaultNodeArgs, filename
    ])
  })

  it("should work with postcss", () =>
    node([
      path.resolve("fixture/scenario/postcss")
    ])
  )

  it("should work with proxyquire", () =>
    node([
      "-r", pkgPath,
      path.resolve("fixture/scenario/proxyquire")
    ], envAuto)
  )

  it("should work with requizzle", () =>
    node([
      "-r", pkgPath,
      path.resolve("fixture/scenario/requizzle")
    ], envAuto)
    .then(({ stdout }) => assert.ok(stdout.includes("requizzle:true")))
  )

  it("should work with rewire", () =>
    node([
      "-r", pkgPath,
      path.resolve("fixture/scenario/rewire")
    ], envAuto)
  )

  it("should work with sinon", () =>
    node([
      path.resolve("fixture/scenario/sinon")
    ], envAuto)
  )

  /**
   * sqreen has been acquired.
  it("should work with sqreen", () =>
    node([
      "-r", pkgPath,
      "-r", "sqreen",
      path.resolve("fixture/scenario/sqreen")
    ], envAuto)
  )
  */

  it("should work with ts-node", () =>
    Promise
      .all([
        "ts-node/register",
        "ts-node/register/transpile-only"
      ]
      .map((request) =>
        node([
          "-r", pkgPath,
          "-r", request,
          path.resolve("fixture/scenario/ts-node/index.ts")
        ], envAuto)
        .then(({ stdout }) => assert.ok(stdout.includes("ts-node:true")))
      ))
  )

  it("should work with unexpected", () =>
    node([
      "-r", pkgPath,
      path.resolve("fixture/scenario/unexpected")
    ])
    .then(({ stdout }) => assert.ok(stdout.includes("unexpected:true")))
  )

  it("should work with webpack", () => {
    const dirPath = path.resolve("fixture/scenario/webpack")
    const configPath = path.resolve(dirPath, "webpack.config.js")
    const entryPath = path.resolve(dirPath, "index.js")
    const outputPath = path.resolve(dirPath, "output.js")

    return exec("webpack", [
      "--config-register", pkgPath,
      "--config", configPath,
      "--entry", entryPath,
      "--mode", "production",
      "--output", outputPath
    ], envAuto)
  })

  it("should work with babel, mocha, and nyc", () => {
    const dirPath = path.resolve("fixture/scenario/babel-mocha-nyc")
    const cwdPath = path.resolve(dirPath, "cwd.js")
    const mochaPattern = path.resolve(dirPath, "test.js")

    return exec("nyc", [
      "--cwd", dirPath,
      "-x", ".babelrc.js", "-x", "test.js",
      "-i", cwdPath,
      // Babel's pirates hook must be installed before esm-sync's hook on
      // modern Node, or Node rejects the wrapped Module prototype.
      "-i", "@babel/register",
      "-i", pkgPath,
      "-i", "@babel/polyfill",
      "mocha", mochaPattern
    ], envAuto)
    .then(({ stdout }) => assert.ok(stdout.includes("1 passing"), stdout))
  })

  it("should work with chai, mocha, and nyc", () => {
    const dirPath = path.resolve("fixture/scenario/chai-mocha-nyc")
    const cwdPath = path.resolve(dirPath, "cwd.js")
    const mochaPattern = path.resolve(dirPath, "test.js")

    return exec("nyc", [
      "--cwd", dirPath,
      "-i", cwdPath,
      "-i", pkgPath,
      "mocha", mochaPattern
    ], envAuto)
    .then(({ stdout }) => assert.ok(stdout.includes("chai-mocha-nyc:true")))
  })

  it("should work with mocha and nyc", () => {
    const dirPath = path.resolve("fixture/scenario/mocha-nyc")
    const cwdPath = path.resolve(dirPath, "cwd.js")
    const mochaPattern = path.resolve(dirPath, "test.js")

    return exec("nyc", [
      "--cwd", dirPath,
      "-x", "test.js",
      "-i", cwdPath,
      "-i", pkgPath,
      "mocha", mochaPattern
    ], envAuto)
    .then(({ stdout }) => assert.ok(stdout.includes("mocha-nyc:true")))
  })

  it("should work with mock-require and require-inject", () =>
    node([
      "-r", pkgPath,
      path.resolve("fixture/scenario/mock-require-inject")
    ], envAuto)
  )

  describe("should work with ava", { skip: !canTestAva }, () => {
    it("should work from the `esm` bridge", () =>
      exec("ava", [
        path.resolve("fixture/scenario/ava/bridge.test.js")
      ], envAuto)
    )

    it("should work from the Node CLI", () => {
      const avaPattern = path.resolve("fixture/scenario/ava/cli.test.js")

      return node([
        "-r", pkgPath,
        avaPath, avaPattern
      ], envAuto)
    })

    it("should work with ava and core-js", () => {
      const dirPath = path.resolve("fixture/scenario/ava-core-js")
      const cwdPath = path.resolve(dirPath, "cwd.js")
      const avaPattern = path.resolve(dirPath, "test.js")

      return node([
        "-r", cwdPath,
        avaPath, avaPattern
      ], envAuto)
    })

    it("should work with ava and nyc", () => {
      const dirPath = path.resolve("fixture/scenario/ava-nyc")
      const cwdPath = path.resolve(dirPath, "cwd.js")
      const avaPattern = path.resolve(dirPath, "test.js")

      return exec("nyc", [
        "--cwd", dirPath,
        "-i", cwdPath,
        "ava", avaPattern
      ], envAuto)
    })

    it("should work with ava and sinon", () => {
      const dirPath = path.resolve("fixture/scenario/ava-sinon")
      const cwdPath = path.resolve(dirPath, "cwd.js")
      const avaPattern = path.resolve(dirPath, "test.js")

      return node([
        "-r", cwdPath,
        avaPath, avaPattern
      ], envAuto)
    })

    it("should work with ava, nyc, and sinon", () => {
      const dirPath = path.resolve("fixture/scenario/ava-nyc-sinon")
      const cwdPath = path.resolve(dirPath, "cwd.js")
      const avaPattern = path.resolve(dirPath, "test.js")

      return exec("nyc", [
        "--cwd", dirPath,
        "-i", cwdPath,
        "ava", avaPattern
      ], envAuto)
    })

    it("should work with ava, nyc, and tsc", () => {
      const dirPath = path.resolve("fixture/scenario/ava-nyc-tsc")
      const cwdPath = path.resolve(dirPath, "cwd.js")
      const avaPattern = path.resolve(dirPath, "test.js")

      return exec("tsc", [
          "--project", dirPath
        ])
        .then(() => exec("nyc", [
          "--cwd", dirPath,
          "-i", cwdPath,
          "-i", pkgPath,
          "ava", avaPattern
        ], envAuto))
    })
  })

  describe("should work with babel plugins", () => {
    it("should work from the `esm` bridge", () =>
      node([
        path.resolve("fixture/scenario/babel-flow")
      ])
      .then(({ stdout }) => assert.ok(stdout.includes("babel-flow:true")))
    )

    it("should work from the Node CLI", () =>
      node([
        "-r", pkgPath,
        "-r", "@babel/register",
        path.resolve("fixture/scenario/babel-flow/main.js")
      ])
      .then(({ stdout }) => assert.ok(stdout.includes("babel-flow:true")))
    )
  })

  describe("should work with flow-remove-types", () => {
    it("should work from the `esm` bridge",  () =>
      node([
        path.resolve("fixture/scenario/flow-remove-types")
      ], envAuto)
      .then(({ stdout }) => assert.ok(stdout.includes("flow-remove-types:true")))
    )

    it("should work from the Node CLI", () =>
      node([
        "-r", pkgPath,
        "-r", "flow-remove-types/register",
        path.resolve("fixture/scenario/flow-remove-types/main.js")
      ], envAuto)
      .then(({ stdout }) => assert.ok(stdout.includes("flow-remove-types:true")))
    )
  })

  describe("should work with jest", () => {
    it("should carry over the context object of jest", function () {
      const dirPath = path.resolve("fixture/scenario/jest-context")
      const configPath = path.resolve(dirPath, "jest.config.json")

      return node([
        jestPath,
        "--config", configPath,
        "--rootDir", dirPath
      ], envAuto)
    })

    it("should carry over the process object of jest", function () {
      const dirPath = path.resolve("fixture/scenario/jest-process")
      const configPath = path.resolve(dirPath, "jest.config.json")

      return node([
        jestPath,
        "--config", configPath,
        "--rootDir", dirPath
      ], envAuto)
    })

    it("should carry over globals from `jest.config.json`", function () {
      const dirPath = path.resolve("fixture/scenario/jest-config-globals")
      const configPath = path.resolve(dirPath, "jest.config.json")

      return node([
        jestPath,
        "--config", configPath,
        "--rootDir", dirPath
      ], envAuto)
    })

    it("should use an empty module cache with jest", function () {
      const dirPath = path.resolve("fixture/scenario/jest-module-cache")
      const configPath = path.resolve(dirPath, "jest.config.json")

      return node([
        jestPath,
        "--config", configPath,
        "--rootDir", dirPath
      ])
    })

    it("should work with jest subclassed console", function () {
      const dirPath = path.resolve("fixture/scenario/jest-console")
      const configPath = path.resolve(dirPath, "jest.config.json")

      return node([
        "-r", pkgPath,
        jestPath,
        "--config", configPath,
        "--rootDir", dirPath
      ])
    })

    it("should work with jest and mock-require", function () {
      const dirPath = path.resolve("fixture/scenario/jest-mock-require")
      const configPath = path.resolve(dirPath, "jest.config.json")

      return node([
        jestPath,
        "--config", configPath,
        "--rootDir", dirPath
      ])
    })

    it("should error with jest and circular dependencies", function () {
      const dirPath = path.resolve("fixture/scenario/jest-cycle")
      const configPath = path.resolve(dirPath, "jest.config.json")

      return node([
        jestPath,
        "--config", configPath,
        "--rootDir", dirPath
      ])
    })
  })

  describe("should work with lab", { skip: !canTestLab }, () => {

    it("should work with lab", () =>
      node([
        "-r", pkgPath,
        labPath, path.resolve("fixture/scenario/lab/test.js")
      ], envAuto)
    )

    it("should work with lab and @babel/register", () =>
      node([
        "-r", pkgPath,
        "-r", "@babel/register",
        labPath, path.resolve("fixture/scenario/lab-babel/test.js")
      ], envAuto)
    )
  })

  describe("should work with pm2", { skip: !canTestPM2, concurrency: false }, () => {

    // Keep the daemon alive across cases so the next app cannot connect to a
    // daemon that is still shutting down on Windows.
    before(async () => {
      pm2Context = await pm2Environment()
    })
    after(stopPM2)
    afterEach(() => pm2Started ? pm2(["delete", "all"]) : undefined)

    // Babel-register startup can exceed PM2's default three-second ready
    // deadline on slower CI machines. Keep PM2's IPC deadline and our log
    // verification deadline aligned; neither is a substitute for the marker.
    const MAX_WAIT = 30000

    let pm2Context
    let pm2Started = false
    const pm2Path = path.resolve("../node_modules/pm2/bin/pm2")
    const defaultPM2Args = [
      "start",
      "--no-autorestart",
      "--wait-ready",
      "--listen-timeout", String(MAX_WAIT),
      // PM2 recognizes "node", but not an absolute "node.exe", as the
      // interpreter that needs its Node container on Windows.
      "--interpreter", isWin ? "node" : nodePath
    ]

    // Keep monitoring enabled in bridge cases and exercise explicit Node
    // preloads without the optional PMX hook in the CLI cases.
    const preloadPM2Args = ["--no-pmx"]

    // PM2 checks process.env.pmx in ProcessContainerFork before loading the
    // application. Preload the guard explicitly: CLI --no-pmx alone does not
    // consistently disable the monitoring hook on Windows.
    const pmxGuardPath = path.resolve("fixture/scenario/pm2-cli-preload.cjs")
      .replace(/\\/g, "/")

    function pm2(args) {
      const env = { ...process.env }
      for (const key of Object.keys(env)) {
        if (key.startsWith("PM2_")) delete env[key]
      }
      delete env.OVER_HOME
      Object.assign(env, pm2Context.env)
      const endpointsPreload = path.resolve("fixture/scenario/pm2-paths-preload.cjs").replace(/\\/g, "/")
      env.NODE_OPTIONS = [env.NODE_OPTIONS, "--require " + JSON.stringify(endpointsPreload)]
        .filter(Boolean).join(" ")
      const pathKeys = Object.keys(env)
        .filter((key) => isWin ? key.toLowerCase() === "path" : key === "PATH")
        .sort()
      const inheritedPath = pathKeys.length ? env[pathKeys[0]] : ""

      // Use the actual test executable for both the CLI and its applications.
      // A runtime launcher on PATH may not forward the application's IPC pipe.
      for (const key of pathKeys) {
        delete env[key]
      }
      env.PATH = [path.dirname(nodePath), inheritedPath].filter(Boolean).join(path.delimiter)

      return execa(nodePath, defaultNodeArgs.concat(pm2Path, args), {
        cwd: testPath,
        env,
        timeout: MAX_WAIT + 5000,
        // Do not merge an inherited Windows "Path" back beside our "PATH".
        extendEnv: false
      })
    }

    async function stopPM2() {
      if (!pm2Context) return
      if (!pm2Started) {
        await fs.remove(pm2Context.home)
        return
      }
      return pm2(["kill"])
        .then(() => {
          const pidPath = path.join(pm2Context.home, "pm2.pid")
          const started = Date.now()

          // PM2's Windows kill command can return on a timeout. The daemon
          // removes its PID file after closing both the RPC and PUB sockets.
          return new Promise(function check(resolve, reject) {
            if (!fs.existsSync(pidPath)) {
              resolve()
            } else if (Date.now() - started >= MAX_WAIT) {
              reject(new Error(`PM2 did not finish shutting down: ${pidPath}`))
            } else {
              setTimeout(() => check(resolve, reject), 100)
            }
          })
        })
        .then(() => fs.remove(pm2Context.home))
    }

    function readLogs(name) {
      const stderrPath = path.resolve(pm2Context.logs, `${name}-error.log`)
      const stdoutPath = path.resolve(pm2Context.logs, `${name}-out.log`)

      return {
        stderr: fs.existsSync(stderrPath)
          ? fs.readFileSync(stderrPath, "utf8")
          : "",
        stdout: fs.existsSync(stdoutPath)
          ? fs.readFileSync(stdoutPath, "utf8")
          : ""
      }
    }

    function waitForLogs(name, expected) {
      const started = Date.now()

      return new Promise(function check(resolve) {
        const waited = Date.now() - started
        const { stderr, stdout } = readLogs(name)

        if (stderr ||
            stdout.split(/\r?\n/).includes(expected) ||
            waited > MAX_WAIT) {
          resolve({ stderr, stdout })
        } else {
          setTimeout(() => check(resolve), 100)
        }
      })
    }

    async function readinessDiagnostic(name, stdout) {
      // A PM2 ready timeout marks the app online even if it never sent ready.
      // When a marker is missing, show the daemon's view instead of reporting
      // an unexplained empty application log.
      const [{ stdout: list }, daemonLog] = await Promise.all([
        pm2(["jlist"]),
        fs.readFile(path.join(pm2Context.home, "pm2.log"), "utf8").catch(() => "")
      ])
      const app = JSON.parse(list).find((entry) => entry.name === name)
      const details = app ? {
        status: app.pm2_env.status,
        pid: app.pid,
        restartTime: app.pm2_env.restart_time,
        exitCode: app.pm2_env.exit_code,
        listenTimeout: app.pm2_env.listen_timeout
      } : null
      return `${name} did not acknowledge PM2 IPC readiness:\n${stdout}\nPM2 state: ${JSON.stringify(details)}\nPM2 daemon log (tail):\n${daemonLog.slice(-4000)}`
    }

    function runPM2(name, args, expected) {
      pm2Started = true
      return pm2(defaultPM2Args.concat("--name", name, args))
        .then(() => waitForLogs(name, expected))
        .then(async ({ stderr, stdout }) => {
          assert.strictEqual(stderr, "")
          if (!stdout.split(/\r?\n/).includes(expected)) {
            assert.fail(await readinessDiagnostic(name, stdout))
          }
          return pm2(["jlist"])
        })
        .then(({ stdout }) => {
          const app = JSON.parse(stdout).find((app) => app.name === name)

          assert.ok(app, `PM2 did not register ${name}`)
          assert.strictEqual(app.pm2_env.status, "online")
          assert.strictEqual(Number(app.pm2_env.listen_timeout), MAX_WAIT)
          assert.ok(app.pid > 0, `${name} did not stay alive until PM2 stopped it`)
          // ProcessContainerFork sends node_version before loading the fixture.
          // This checks that the startup message reached the daemon as well.
          assert.strictEqual(app.pm2_env.node_version, process.versions.node)
          return pm2(["stop", name])
        })
        .then(() => {
          // Read again after stopping the app so late errors cannot be hidden
          // by the first success marker or by daemon teardown.
          const { stderr, stdout } = readLogs(name)

          assert.strictEqual(stderr, "")
          assert.ok(stdout.split(/\r?\n/).includes(expected), stdout)
        })
    }

    it("should work from the `esm` bridge", () => {
      const pm2Args = [
        "--node-args", defaultNodeArgs.join(" "),
        path.resolve("fixture/scenario/pm2")
      ]

      return runPM2("pm2-bridge", pm2Args, "pm2:true")
    })

    it("should work from the Node CLI", () => {
      const nodeArgs = defaultNodeArgs.concat(
        "-r", pmxGuardPath,
        "-r", pkgPath.replace(/\\/g, "/")
      )

      const pm2Args = preloadPM2Args.concat(
        "--node-args", nodeArgs.join(" "),
        path.resolve("fixture/scenario/pm2/main.js")
      )

      return runPM2("pm2-cli", pm2Args, "pm2:true")
    })

    it("should work with babel/register from the `esm` bridge", () => {
      const pm2Args = [
        "--node-args", defaultNodeArgs.join(" "),
        path.resolve("fixture/scenario/pm2-babel")
      ]

      return runPM2("pm2-babel-bridge", pm2Args, "pm2-babel:true")
    })

    it("should work with babel/register from the Node CLI", () => {
      const nodeArgs = defaultNodeArgs.concat(
        "-r", pmxGuardPath,
        "-r", pkgPath.replace(/\\/g, "/"),
        "-r", "@babel/register"
      )

      const pm2Args = preloadPM2Args.concat(
        "--node-args", nodeArgs.join(" "),
        path.resolve("fixture/scenario/pm2-babel/main.js")
      )

      return runPM2("pm2-babel-cli", pm2Args, "pm2-babel:true")
    })
  })

  describe("should work with `util.inspect()`", () => {
    it("should work from the `esm` bridge without options", () =>
      node([
        path.resolve("fixture/scenario/inspect/without-options.js")
      ])
      .then(({ stdout }) => assert.ok(stdout.includes("inspect:true")))
    )

    it("should work from the `esm` bridge with options", () =>
      node([
        path.resolve("fixture/scenario/inspect/with-options.js")
      ])
      .then(({ stdout }) => assert.ok(stdout.includes("inspect:true")))
    )
  })
})
