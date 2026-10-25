"use strict"

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"
import execa from "execa"
import { consumerFormats, verifyInstalledPackage } from "./package-smoke.js"

const rootPath = path.resolve(__dirname, "..")
const loaderPath = path.resolve(rootPath, "esm/loader.js")
const fixturePath = path.resolve(rootPath, "test/packed")
const { values } = parseArgs({ options: { format: { type: "string", default: "cjs" } } })
const formats = consumerFormats(values.format ?? "cjs")

async function testPackedPackage() {
  try {
    await fs.access(loaderPath)
  } catch {
    throw new Error("Loader bundle is missing. Run `pnpm build --test` before `pnpm test:packed`.")
  }

  const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), "esm-sync-packed-"))
  const tarballPath = path.join(tempPath, "esm-sync.tgz")
  const consumerPath = path.join(tempPath, "consumer")

  try {
    await fs.cp(fixturePath, consumerPath, { recursive: true })
    await fs.writeFile(
      path.join(consumerPath, "package.json"),
      '{"name":"esm-sync-packed-smoke","private":true,"type":"commonjs"}\n'
    )

    await execa("pnpm", ["pack", "--ignore-scripts", "--out", tarballPath], {
      cwd: rootPath,
      stdio: "inherit"
    })

    await fs.access(tarballPath)

    await execa("pnpm", ["add", "--ignore-scripts", tarballPath], {
      cwd: consumerPath,
      stdio: "inherit"
    })

    await verifyInstalledPackage(consumerPath, formats)
  } finally {
    await fs.rm(tempPath, { force: true, recursive: true })
  }
}

testPackedPackage().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
