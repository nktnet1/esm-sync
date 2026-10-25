"use strict"

import execa from "execa"
import fs from "fs-extra"
import path from "path"
import { createPublishManifest } from "./package-manifest.js"

const rootPath = path.resolve(__dirname, "../..")
const pkgPath = path.resolve(rootPath, "package.json")

function buildPackage() {
  return execa(process.execPath, [path.join(__dirname, "build.js"), "--prod"], {
    cwd: rootPath,
    stdio: "inherit"
  })
}

function cleanPackageJSON() {
  const content = fs.readFileSync(pkgPath, "utf8")

  process.once("exit", () => fs.outputFileSync(pkgPath, content))

  const pkgJSON = createPublishManifest(JSON.parse(content) as Record<string, unknown>)
  fs.outputFileSync(pkgPath, JSON.stringify(pkgJSON, null, 2) + "\n")
}

function publishPackage() {
  return execa("pnpm", ["publish"], {
    cwd: rootPath,
    stdio: "inherit"
  })
}

Promise.resolve()
  .then(buildPackage)
  .then(cleanPackageJSON)
  .then(publishPackage)
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
