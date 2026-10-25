"use strict"

import fs from "fs-extra"
import globby from "globby"
import path from "path"

const rootPath = path.resolve(__dirname, "../..")
const gitignorePath = path.resolve(rootPath, ".gitignore")

const patterns = fs
  .readFileSync(gitignorePath, "utf8")
  .split(/\r?\n/)
  .map((sourceLine) => {
    sourceLine = sourceLine.trim()

    if (sourceLine !== "") {
      return sourceLine.startsWith("/") ? sourceLine.slice(1) : "**/" + sourceLine
    }

    return sourceLine
  })
  .filter(Boolean)

export = globby
  .sync(patterns, {
    absolute: true,
    cwd: rootPath,
    dot: true,
    expandDirectories: false,
    onlyFiles: false
  })
  .map((thePath) => path.normalize(thePath))
