"use strict"

// Node can truncate very long uncaught stack traces before the error code
// reaches a pipe (notably when the production loader is a single line).
process.on("uncaughtException", (error) => {
  process.stderr.write(
    `main-hook-error:${JSON.stringify({ code: error.code, message: error.message })}\n`
  )
  process.exitCode = 1
})
