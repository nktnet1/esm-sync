"use strict"

const { writeSync } = require("node:fs")

// Report the actual exception before Node prints the minified loader source.
// A monitor preserves Node's normal uncaught-exception handling and exit code.
process.once("uncaughtExceptionMonitor", (error) => {
  writeSync(2, `builtin-error:${JSON.stringify({ name: error.name, message: error.message })}\n`)
})
