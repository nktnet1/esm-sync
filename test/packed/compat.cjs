"use strict"

const { runCompatibilityCheck } = require("./check-compat.cjs")

const check = process.argv[2]
// Run native Node resolution before esm-sync installs its legacy loader hooks.
const esmRequire = check === "native" ? undefined : require("esm-sync")(module)
runCompatibilityCheck(check, esmRequire).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
