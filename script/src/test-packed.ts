"use strict"

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import execa from "execa"

const rootPath = path.resolve(__dirname, "..")
const loaderPath = path.resolve(rootPath, "esm/loader.js")
const fixturePath = path.resolve(rootPath, "test/packed")

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

    const installedPath = path.join(consumerPath, "node_modules/esm-sync")

    for (const filename of [
      "index.js",
      "index.d.ts",
      "esm.js",
      "esm/loader.js",
      "native/sync-await.cc",
      `native/${process.platform}-${process.arch}-${process.versions.modules}.node`,
      "script/build-sync-await.js"
    ]) {
      await fs.access(path.join(installedPath, filename))
    }

    await execa(process.execPath, ["consumer.cjs"], {
      cwd: consumerPath,
      stdio: "inherit"
    })

    await execa(process.execPath, ["--require", "esm-sync", "cli.js"], {
      cwd: consumerPath,
      stdio: "inherit"
    })
  } finally {
    await fs.rm(tempPath, { force: true, recursive: true })
  }
}

testPackedPackage().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
