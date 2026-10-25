"use strict"

import execa from "execa"
import fs from "fs-extra"
import path from "path"
import { createPublishManifest } from "./package-manifest.js"

const rootPath = path.resolve(__dirname, "..")
const pkgPath = path.resolve(rootPath, "package.json")
const readmePath = path.resolve(rootPath, "README.md")

const tableRegExp = /^<table>[\s\S]*?\n<\/table>/gm
function buildPackage() {
  return execa(
    process.execPath,
    [path.join(rootPath, "script/src/esm/cli.ts"), "build", "--prod"],
    {
      cwd: rootPath,
      stdio: "inherit"
    }
  )
}

function cleanPackageJSON() {
  const content = fs.readFileSync(pkgPath, "utf8")

  process.once("exit", () => fs.outputFileSync(pkgPath, content))

  const pkgJSON = createPublishManifest(JSON.parse(content) as Record<string, unknown>)
  fs.outputFileSync(pkgPath, JSON.stringify(pkgJSON, null, 2) + "\n")
}

async function cleanReadme() {
  const content = fs.readFileSync(readmePath, "utf8")
  const matches = Array.from(content.matchAll(tableRegExp))
  const tables = await Promise.all(matches.map(([table]) => minifyHTML(table)))
  let index = 0

  process.once("exit", () => fs.outputFileSync(readmePath, content))

  fs.outputFileSync(
    readmePath,
    content.replace(tableRegExp, () => tables[index++]!)
  )
}

async function minifyHTML(content: string) {
  // import/no-unresolved does not resolve packages with only ESM exports.
  const { minify } = await import("html-minifier-next")

  return minify(content, {
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    decodeEntities: true,
    removeAttributeQuotes: true,
    removeComments: true,
    removeEmptyAttributes: true,
    removeEmptyElements: true,
    removeOptionalTags: true,
    removeRedundantAttributes: true,
    removeTagWhitespace: true
  })
}

function publishPackage() {
  return execa("pnpm", ["publish"], {
    cwd: rootPath,
    stdio: "inherit"
  })
}

Promise.resolve()
  .then(buildPackage)
  .then(() => Promise.all([cleanPackageJSON(), cleanReadme()]))
  .then(publishPackage)
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
