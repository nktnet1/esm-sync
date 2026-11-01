"use strict"

import fs from "fs-extra"
import globby from "globby"
import path from "path"

const rootPath = path.resolve(__dirname, "../..")
const gitignorePath = path.resolve(rootPath, ".gitignore")

const patterns = fs
  .readFileSync(gitignorePath, "utf8")
  .split(/\r?\n/)
  .flatMap((sourceLine) => {
    const line = sourceLine.trim()
    if (line === "" || line.startsWith("#")) return []

    // Keep the negation at the start of the glob. Prefixing it with **/
    // turns a .gitignore exception into a positive pattern and can delete source.
    const negated = line.startsWith("!")
    const body = negated ? line.slice(1) : line
    const pattern = body.startsWith("/") ? body.slice(1) : "**/" + body
    return [negated ? "!" + pattern : pattern]
  })

export = globby
  .sync(patterns, {
    absolute: true,
    cwd: rootPath,
    dot: true,
    expandDirectories: false,
    onlyFiles: false
  })
  .map((thePath) => path.normalize(thePath))
