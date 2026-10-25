"use strict"

import execa from "execa"
import fs from "fs-extra"
import path from "path"
import trash from "./trash.js"
import buildSyncAwait from "./build-sync-await.js"

import { program } from "commander"

program.option("--prod", "enable production mode").option("--test", "enable test mode")

program.parse(process.argv)

const argv = program.opts<{ prod?: boolean; test?: boolean }>()

const NODE_ENV = argv.prod ? "production" : "development"
const ESM_ENV = NODE_ENV + (argv.test ? "-test" : "")

const rootPath = path.resolve(__dirname, "..")
const buildPath = path.resolve(rootPath, "build")
const loaderPath = path.resolve(rootPath, "esm/loader.js")
const acornPath = path.resolve(rootPath, "src/vendor/acorn/acorn/src/state.js")
const acornPackagePath = path.resolve(rootPath, "src/vendor/acorn/acorn/package.json")
import acornPackage from "acorn/package.json"
const acornVersion = acornPackage.version

const trashPaths = [buildPath, loaderPath]

function assertFixturesReady() {
  const isReady =
    fs.existsSync(acornPath) &&
    fs.existsSync(acornPackagePath) &&
    (fs.readJSONSync(acornPackagePath) as { version?: unknown }).version === acornVersion

  if (!isReady) {
    throw new Error(
      "Acorn fixture is missing or outdated. Run `pnpm fixtures:acorn` before building."
    )
  }
}

function cleanRepo() {
  return Promise.all(trashPaths.map(trash))
}

function copyBundle() {
  const srcPath = path.resolve(buildPath, "esm.js")

  if (!fs.existsSync(srcPath)) {
    throw new Error("Rspack completed without producing build/esm.js")
  }

  return fs.copy(srcPath, loaderPath)
}

function makeBundle() {
  return execa("rspack", ["--config", "script/rspack-config.js"], {
    cwd: rootPath,
    env: {
      ESM_ENV,
      NODE_ENV
    },
    stdio: "inherit"
  })
}

Promise.resolve()
  .then(assertFixturesReady)
  .then(() => buildSyncAwait({ required: argv.test }))
  .then(cleanRepo)
  .then(makeBundle)
  .then(copyBundle)
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
