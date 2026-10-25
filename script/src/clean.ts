"use strict"

import fs from "fs-extra"
import globby from "globby"
import ignorePaths from "./ignore-paths.js"
import path from "path"
import trash from "./trash.js"

const rootPath = path.resolve(__dirname, "../..")
const nodeModulesPath = path.resolve(rootPath, "node_modules")

const keptPaths = [nodeModulesPath]
const trashPaths = ignorePaths.filter(isKept)

function cleanEmptyDirs() {
  return Promise.all(
    globby
      .sync(["*/**/"], {
        absolute: true,
        cwd: rootPath,
        expandDirectories: false,
        onlyDirectories: true
      })
      .filter(isEmpty)
      .map(trash)
  )
}

function cleanNodeModules() {
  return trash(nodeModulesPath)
}

function cleanRepo() {
  return Promise.all(trashPaths.map(trash))
}

function isEmpty(dirPath: string) {
  return !fs.readdirSync(dirPath).length
}

function isKept(thePath: string) {
  return keptPaths.every((dirname) => !thePath.startsWith(dirname))
}

cleanRepo().then(cleanEmptyDirs).then(cleanNodeModules)
