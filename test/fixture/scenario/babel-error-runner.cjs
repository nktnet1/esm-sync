"use strict"

// Keep this launcher outside the fixture directory so its intentionally failing
// .babelrc applies only to the module loaded inside the try block.
// Report the caught error instead of relying on a potentially huge native stack trace.
try {
  require("./babel-error/index.js")
} catch (error) {
  const detail = error && typeof error.message === "string" ? error.message : String(error)
  process.stderr.write(`babel-error:${detail}\n`)
  process.exitCode = 1
}
