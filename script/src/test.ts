"use strict"

import execa from "execa"
import fs from "fs-extra"
import ignorePaths from "./ignore-paths.js"
import setupNativeAddon from "./setup-native-addon.js"
import path from "path"
import createTestCleanupFilter from "./test-cleanup-paths.js"
import trash from "./trash.js"
import { harnessOutputs } from "./esm/outputs.js"

import { program } from "commander"

program.option("--prod")
program.parse()

const argv = program.opts<{ prod?: boolean }>()
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
  path.resolve(rootPath, "script"),
  path.resolve(rootPath, "esm.js"),
  path.resolve(rootPath, "index.js"),
  path.resolve(rootPath, ".ncurc.mjs"),
  path.resolve(rootPath, "debug/debug.js"),
  path.resolve(rootPath, "debug/module.js"),
  nodeModulesPath,
  path.resolve(rootPath, "src/vendor"),
  path.resolve(rootPath, "test/vendor"),
  ...Object.values(harnessOutputs).map((filename) => path.resolve(rootPath, filename))
]
const trashPaths = ignorePaths.filter(
  createTestCleanupFilter({ keptPaths, nodeModulesPath, sharedCachePath })
)

function assertFixturesReady() {
  if (
    !fs.existsSync(path.resolve(rootPath, "build/compiler.js")) ||
    !fs.existsSync(path.resolve(rootPath, "esm/loader.js"))
  ) {
    throw new Error("Test bundles are missing. Run `pnpm build --test` before testing.")
  }
}

async function dispose(paths: string[]) {
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
  .then(setupRepo)
  .then(setupNode)
  .then(setupNativeAddon)
  .then(runTests)
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
