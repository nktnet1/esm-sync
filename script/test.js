"use strict"

const SemVer = require("semver")

const execa = require("execa")
const semver = require("semver")
const fs = require("fs-extra")
const ignorePaths = require("./ignore-paths.js")
const path = require("path")
const terser = require("terser").minify
const trash = require("./trash.js")

const { program } = require("commander")

program.option("--prod").option("--test")

program.parse()

const argv = program.opts()

const isWin = process.platform === "win32"

const rootPath = path.resolve(__dirname, "..")
const testPath = path.resolve(rootPath, "test")
const envPath = path.resolve(testPath, "env")
const esmPath = path.resolve(rootPath, "esm.js")
const fixturePath = path.resolve(testPath, "fixture")
const indexPath = path.resolve(rootPath, "index.js")
const mochaPath = path.resolve(rootPath, "node_modules/mocha/bin/_mocha")
const nodeModulesPath = path.resolve(rootPath, "node_modules")
const sharedCachePath = path.resolve(nodeModulesPath, ".cache")
const nodePath = path.resolve(envPath, "prefix", isWin ? "node.exe" : "bin/node")
const test262HarnessPath = path.resolve(testPath, "vendor/test262/harness/assert.js")
const testBundlePath = path.resolve(rootPath, "build/compiler.js")
const loaderPath = path.resolve(rootPath, "esm/loader.js")

const NODE_ENV = argv.prod ? "production" : "development"
const ESM_ENV = NODE_ENV + "-test"
const HOME = path.resolve(envPath, "home")

const NODE_PATH = [
  path.resolve(envPath, "node_path"),
  path.resolve(envPath, "node_path/relative")
].join(path.delimiter)

const jsPaths = [esmPath, indexPath]

const keptPaths = [
  path.resolve(rootPath, "build"),
  path.resolve(rootPath, "esm"),
  path.resolve(rootPath, "node_modules"),
  path.resolve(rootPath, "src/vendor"),
  path.resolve(rootPath, "test/vendor")
]

const nodeArgs = []

// Worker threads have not required this flag since Node 11.7.
if (SemVer.satisfies(process.version, ">=10.5 <11.7")) {
  nodeArgs.push("--experimental-worker")
}

if (process.env.HARMONY) {
  nodeArgs.push("--harmony")
}

nodeArgs.push(mochaPath, "--full-trace", "--require", "../index.js", "tests.js")

const terserOptions = fs.readJSONSync(path.resolve(rootPath, ".terserrc"))
const trashPaths = ignorePaths.filter(isKept)

function assertFixturesReady() {
  if (!fs.existsSync(test262HarnessPath)) {
    throw new Error("Test262 fixture is missing. Run `pnpm fixtures:prepare` before testing.")
  }

  if (!fs.existsSync(testBundlePath) || !fs.existsSync(loaderPath)) {
    throw new Error("Test bundles are missing. Run `pnpm build --test` before testing.")
  }
}

async function cleanJS() {
  for (const filename of jsPaths) {
    const content = fs.readFileSync(filename, "utf8")
    const code = await minifyJS(content)

    process.once("exit", () => fs.outputFileSync(filename, content))

    fs.outputFileSync(filename, code)
  }
}

function isKept(thePath) {
  // Only the shared cache should be cleared under node_modules, not dependency caches.
  if (thePath.startsWith(nodeModulesPath + path.sep)) {
    return thePath === sharedCachePath
  }

  return thePath.endsWith(".cache") || keptPaths.every((dirname) => !thePath.startsWith(dirname))
}

async function minifyJS(content) {
  const { code } = await terser(content, terserOptions)

  if (typeof code !== "string") {
    throw new Error("Terser did not produce JavaScript output")
  }

  return code
}

function runTests(cached) {
  // Disables [DEP0144] DeprecationWarning:
  //     module.parent is deprecated due to accuracy issues.
  //     Please use require.main to find program entry point instead.
  const nodeOptions = [
    "--trace-warnings",
    ...(semver.gte(process.versions.node, "20.11.0") ? ["--disable-warning=DEP0144"] : [])
  ].join(" ")

  return execa(nodePath, nodeArgs, {
    cwd: testPath,
    env: {
      ESM_ENV: ESM_ENV + (cached ? "-cached" : ""),
      ESM_OPTIONS: "{cjs:false,mode:'auto'}",
      HOME,
      NODE_ENV,
      NODE_OPTIONS: nodeOptions,
      NODE_PATH,
      NODE_PENDING_DEPRECATION: 1,
      USERPROFILE: HOME
    },
    stdio: "inherit"
  })
}

function setupNode() {
  const basePath = path.resolve(nodePath, isWin ? "" : "..")

  return trash(basePath).then(() => fs.ensureLink(process.execPath, nodePath))
}

async function setupRepo() {
  // Preserve recoverable cleanup for ignored files while removing caches idempotently.
  await trash(trashPaths.filter((thePath) => !thePath.endsWith(".cache")))

  for (const cachePath of trashPaths.filter((thePath) => thePath.endsWith(".cache"))) {
    await fs.remove(cachePath)
  }

  if (!isWin) {
    const safeCharactersPath = path.resolve(fixturePath, "safe-characters[#%&;=].mjs")
    const unsafeCharactersPath = path.resolve(fixturePath, "unsafe-characters[\b\t\n\r:?].mjs")

    if (!fs.existsSync(unsafeCharactersPath)) {
      fs.copySync(safeCharactersPath, unsafeCharactersPath)
    }
  }
}

Promise.resolve()
  .then(assertFixturesReady)
  .then(() => Promise.all([argv.prod && cleanJS(), setupRepo()]))
  .then(setupNode)
  .then(() => {
    console.log("Running tests...")
  })
  .then(() => runTests())
  .then(() => runTests(true))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
