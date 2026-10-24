"use strict"

import { devDependencies } from "../package.json"
import semver from "semver"

const expected = devDependencies.typescript
let installed: string | undefined

try {
  const metadata: unknown = require("typescript/package.json")
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    !("version" in metadata) ||
    typeof metadata.version !== "string"
  ) {
    throw new TypeError("TypeScript package metadata has no version")
  }
  installed = metadata.version
} catch (error) {
  console.error(
    `Unable to load TypeScript: ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
}

if (installed && !semver.satisfies(installed, expected)) {
  console.error(
    `Installed TypeScript ${installed} does not satisfy ${expected}. ` +
      "Synchronise dependencies with package.json before running type checks."
  )
  process.exitCode = 1
}
