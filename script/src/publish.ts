"use strict"

import execa from "execa"
import fleece from "golden-fleece"
import fs from "fs-extra"
import path from "path"
import { minify as terser } from "terser"

const rootPath = path.resolve(__dirname, "..")
const esmPath = path.resolve(rootPath, "esm.js")
const indexPath = path.resolve(rootPath, "index.js")
const pkgPath = path.resolve(rootPath, "package.json")
const readmePath = path.resolve(rootPath, "README.md")

const tableRegExp = /^<table>[\s\S]*?\n<\/table>/gm
const terserOptions = fs.readJSONSync(
  path.resolve(rootPath, ".terserrc")
) as import("terser").MinifyOptions

const defaultScripts = {
  test: 'echo "Error: no test specified" && exit 1'
}

const fieldsToRemove = ["devDependencies", "esm", "private", "scripts"]

const jsPaths = [esmPath, indexPath]

async function cleanJS() {
  for (const filename of jsPaths) {
    const content = fs.readFileSync(filename, "utf8")
    const code = await minifyJS(content)

    process.once("exit", () => fs.outputFileSync(filename, content))

    fs.outputFileSync(filename, code)
  }
}

function cleanPackageJSON() {
  const content = fs.readFileSync(pkgPath, "utf8")

  process.once("exit", () => fs.outputFileSync(pkgPath, content))

  const pkgJSON = JSON.parse(content) as Record<string, unknown>

  for (const field of fieldsToRemove) {
    Reflect.deleteProperty(pkgJSON, field)
  }

  pkgJSON.scripts = defaultScripts
  fs.outputFileSync(pkgPath, fleece.patch(content, pkgJSON))
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

async function minifyJS(content: string) {
  const { code } = await terser(content, terserOptions)

  if (typeof code !== "string") {
    throw new Error("Terser did not produce JavaScript output")
  }

  return code
}

function publishPackage() {
  return execa("pnpm", ["publish"], {
    cwd: rootPath,
    stdio: "inherit"
  })
}

Promise.all([cleanJS(), cleanPackageJSON(), cleanReadme()])
  .then(publishPackage)
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
