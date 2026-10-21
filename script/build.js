"use strict"

const execa = require("execa")
const fs = require("fs-extra")
const path = require("path")
const trash = require("./trash.js")

const { program } = require("commander")

program.option("--prod", "enable production mode").option("--test", "enable test mode")

program.parse(process.argv)

const argv = program.opts()

const NODE_ENV = argv.prod ? "production" : "development"
const ESM_ENV = NODE_ENV + (argv.test ? "-test" : "")

const rootPath = path.resolve(__dirname, "..")
const buildPath = path.resolve(rootPath, "build")
const loaderPath = path.resolve(rootPath, "esm/loader.js")
const acornPath = path.resolve(rootPath, "src/vendor/acorn/acorn/src/state.js")
const acornPackagePath = path.resolve(rootPath, "src/vendor/acorn/acorn/package.json")
const acornVersion = require("acorn/package.json").version

const trashPaths = [buildPath, loaderPath]

function assertFixturesReady() {
  const isReady =
    fs.existsSync(acornPath) &&
    fs.existsSync(acornPackagePath) &&
    fs.readJSONSync(acornPackagePath).version === acornVersion

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
  return execa("rspack", {
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
  .then(cleanRepo)
  .then(makeBundle)
  .then(copyBundle)
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
