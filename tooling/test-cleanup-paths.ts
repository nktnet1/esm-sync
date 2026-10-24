"use strict"

import path from "path"

function isWithin(absolutePath: string, directory: string, paths: typeof path): boolean {
  const relative = paths.relative(directory, absolutePath)
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative))
  )
}

function createTestCleanupFilter(
  {
    keptPaths,
    nodeModulesPath,
    sharedCachePath
  }: { keptPaths: string[]; nodeModulesPath: string; sharedCachePath: string },
  paths = path
) {
  return (candidate: string) => {
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

export = createTestCleanupFilter
