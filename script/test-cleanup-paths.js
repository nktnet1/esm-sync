"use strict"

const path = require("path")

function isWithin(absolutePath, directory, paths) {
  const relative = paths.relative(directory, absolutePath)
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative))
  )
}

function createTestCleanupFilter({ keptPaths, nodeModulesPath, sharedCachePath }, paths = path) {
  return (candidate) => {
    const absolutePath = paths.resolve(candidate)

    if (isWithin(absolutePath, nodeModulesPath, paths)) {
      return paths.relative(sharedCachePath, absolutePath) === ""
    }

    return (
      absolutePath.endsWith(".cache") ||
      keptPaths.every((directory) => !isWithin(absolutePath, directory, paths))
    )
  }
}

module.exports = createTestCleanupFilter
