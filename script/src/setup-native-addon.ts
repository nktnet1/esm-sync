"use strict"

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const rootPath = path.resolve(__dirname, "../..")
const fixturePath = path.join(rootPath, "dist/test/fixture/scenario/native")
const sourcePath = path.join(fixturePath, "addon.c")
const outputPath = path.join(fixturePath, "addon.node")
const nodeDir = path.dirname(fs.realpathSync(process.execPath))
const includePath =
  process.env.ESM_SYNC_NODE_HEADERS ||
  path.resolve(nodeDir, process.platform === "win32" ? "include/node" : "../include/node")
const libraryPath = process.env.ESM_SYNC_NODE_LIB || nodeDir

function compile() {
  if (!fs.existsSync(path.join(includePath, "node_api.h"))) {
    throw new Error(`Node-API headers not found in ${includePath}`)
  }

  const win = process.platform === "win32"
  const mac = process.platform === "darwin"
  const compiler = process.env.CC || (win ? "cl.exe" : "cc")
  const args = win
    ? [
        "/nologo",
        "/LD",
        `/I${includePath}`,
        `/Fe:${outputPath}`,
        sourcePath,
        "/link",
        `/LIBPATH:${libraryPath}`,
        "node.lib"
      ]
    : [
        ...(mac ? ["-bundle", "-undefined", "dynamic_lookup"] : ["-shared", "-fPIC"]),
        `-I${includePath}`,
        "-o",
        outputPath,
        sourcePath
      ]

  return new Promise<void>((resolve, reject) => {
    const child = spawn(compiler, args, { cwd: fixturePath, stdio: "inherit" })
    child.once("error", reject)
    child.once("close", (code, signal) => {
      if (code === 0) {
        console.log("[native] Node-API fixture compiled.")
        resolve()
      } else {
        reject(new Error(`Native fixture compilation failed (${signal || code})`))
      }
    })
  })
}

export = compile
