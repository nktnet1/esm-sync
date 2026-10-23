"use strict"

const execa = require("execa")
const fs = require("fs-extra")
const ignorePaths = require("./ignore-paths.js")
const setupNativeAddon = require("./setup-native-addon.js")
const path = require("path")
const createTestCleanupFilter = require("./test-cleanup-paths.js")
const terser = require("terser").minify
const trash = require("./trash.js")

const { program } = require("commander")

program.option("--prod")
program.parse()

const argv = program.opts()
const isWin = process.platform === "win32"
const rootPath = path.resolve(__dirname, "..")
const testPath = path.resolve(rootPath, "test")
const envPath = path.resolve(testPath, "env")
const fixturePath = path.resolve(testPath, "fixture")
const nodePath = path.resolve(envPath, "prefix", isWin ? "node.exe" : "bin/node")
const nodeModulesPath = path.resolve(rootPath, "node_modules")
const sharedCachePath = path.resolve(nodeModulesPath, ".cache")
const NODE_ENV = argv.prod ? "production" : "development"

const keptPaths = [
  path.resolve(rootPath, "build"),
  path.resolve(rootPath, "esm"),
  path.resolve(rootPath, "native"),
  nodeModulesPath,
  path.resolve(rootPath, "src/vendor"),
  path.resolve(rootPath, "test/vendor")
]
const jsPaths = [path.resolve(rootPath, "esm.js"), path.resolve(rootPath, "index.js")]
const trashPaths = ignorePaths.filter(
  createTestCleanupFilter({ keptPaths, nodeModulesPath, sharedCachePath })
)
const terserOptions = fs.readJSONSync(path.resolve(rootPath, ".terserrc"))

function assertFixturesReady() {
  if (
    !fs.existsSync(path.resolve(rootPath, "build/compiler.js")) ||
    !fs.existsSync(path.resolve(rootPath, "esm/loader.js"))
  ) {
    throw new Error("Test bundles are missing. Run `pnpm build --test` before testing.")
  }
}

async function dispose(paths) {
  // CI workspaces are disposable; the Windows Recycle Bin helper can fail
  // when no interactive desktop is available on GitHub-hosted runners.
  if (isWin && process.env.CI === "true") {
    for (const thePath of paths) {
      await fs.remove(thePath)
    }
    return
  }

  await trash(paths)
}

async function cleanJS() {
  for (const filename of jsPaths) {
    const content = fs.readFileSync(filename, "utf8")
    const { code } = await terser(content, terserOptions)

    if (typeof code !== "string") {
      throw new Error("Terser did not produce JavaScript output")
    }

    // Production runs exercise minified public entry points without altering git files.
    process.once("exit", () => fs.outputFileSync(filename, content))
    fs.outputFileSync(filename, code)
  }
}

async function setupRepo() {
  // Preserve recoverable cleanup for ignored files while clearing caches.
  await dispose(trashPaths.filter((thePath) => !thePath.endsWith(".cache")))

  for (const cachePath of trashPaths.filter((thePath) => thePath.endsWith(".cache"))) {
    await fs.remove(cachePath)
  }

  if (!isWin) {
    const safePath = path.resolve(fixturePath, "safe-characters[#%&;=].mjs")
    const unsafePath = path.resolve(fixturePath, "unsafe-characters[\b\t\n\r:?].mjs")

    if (!fs.existsSync(unsafePath)) {
      fs.copySync(safePath, unsafePath)
    }
  }
}

async function setupNode() {
  const basePath = path.resolve(nodePath, isWin ? "" : "..")
  await dispose([basePath])
  // Keep the fixture executable independent of the selected runtime. Copying
  // also works when pnpm's runtime and the checkout are on different volumes.
  await fs.ensureDir(path.dirname(nodePath))
  await fs.copyFile(process.execPath, nodePath)
}

function runTests() {
  const vitest = path.resolve(rootPath, "node_modules/vitest/vitest.mjs")
  return execa(process.execPath, [vitest, "run", ...(argv.prod ? ["--mode", "production"] : [])], {
    cwd: rootPath,
    env: { NODE_ENV },
    stdio: "inherit"
  })
}

Promise.resolve()
  .then(assertFixturesReady)
  .then(() => Promise.all([argv.prod && cleanJS(), setupRepo()]))
  .then(setupNode)
  .then(setupNativeAddon)
  .then(runTests)
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
