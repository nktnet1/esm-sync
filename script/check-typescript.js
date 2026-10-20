"use strict"

const { devDependencies } = require("../package.json")
const semver = require("semver")

const expected = devDependencies.typescript
let installed

try {
  installed = require("typescript/package.json").version
} catch (error) {
  console.error(`Unable to load TypeScript: ${error.message}`)
  process.exitCode = 1
}

if (installed && !semver.satisfies(installed, expected)) {
  console.error(
    `Installed TypeScript ${installed} does not satisfy ${expected}. ` +
      "Synchronise dependencies with package.json before running type checks."
  )
  process.exitCode = 1
}
