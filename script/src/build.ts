"use strict"

import execa from "execa"
import fs from "fs-extra"
import path from "path"
import buildSyncAwait from "./build-sync-await.js"

import { program } from "commander"

program.option("--prod", "enable production mode").option("--test", "enable test mode")

program.parse(process.argv)

const argv = program.opts<{ prod?: boolean; test?: boolean }>()

const NODE_ENV = argv.prod ? "production" : "development"
const ESM_ENV = NODE_ENV + (argv.test ? "-test" : "")

const rootPath = path.resolve(__dirname, "../..")
const acornPath = path.resolve(rootPath, "src/vendor/acorn/acorn/src/state.js")
const acornPackagePath = path.resolve(rootPath, "src/vendor/acorn/acorn/package.json")
import acornPackage from "acorn/package.json"
const acornVersion = acornPackage.version

// Tooling is executing from dist/script, so clean only bundler-owned output.
const publicOutputs = [
  "dist/esm.js",
  "dist/esm.d.ts",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/esm/loader.js",
  "dist/script/build-sync-await.js"
]
const bundlePaths = [
  "dist/build",
  "dist/esm",
  ...publicOutputs.filter((filename) => !filename.startsWith("dist/esm/"))
]
let complete = false
process.once("exit", (code) => {
  if (code === 0 && !complete) {
    console.error("Build exited before verifying the generated package outputs.")
    process.exitCode = 1
  }
})

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
  return Promise.all(bundlePaths.map((filename) => fs.remove(path.resolve(rootPath, filename))))
}

function makeBundle() {
  return execa(process.execPath, [require.resolve("tsdown/run"), "--config", "tsdown.config.mts"], {
    cwd: rootPath,
    env: {
      ESM_ENV,
      NODE_ENV
    },
    stdio: "inherit"
  })
}

function verifyOutputs() {
  const missing = publicOutputs.filter((filename) => !fs.existsSync(path.join(rootPath, filename)))
  if (missing.length)
    throw new Error("tsdown did not produce required package files: " + missing.join(", "))
  complete = true
}

Promise.resolve()
  .then(assertFixturesReady)
  .then(() => buildSyncAwait({ required: argv.test }))
  .then(cleanRepo)
  .then(makeBundle)
  .then(verifyOutputs)
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
