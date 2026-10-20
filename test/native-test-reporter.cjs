"use strict"

// Each native suite executes once, but Vitest needs its individual results.
// Structured node:test events avoid scraping human-readable TAP/spec output.
module.exports = async function* reporter(source) {
  for await (const { type, data } of source) {
    let record

    if (type === "test:summary") {
      record = { kind: "summary", counts: data.counts, success: data.success }
    } else if (type === "test:pass" || type === "test:fail") {
      const { details } = data

      if (details.type === "test") {
        const error = details.error
        const cause = error?.cause

        record = {
          kind: "test",
          name: data.name,
          line: data.line,
          column: data.column,
          status: data.skip ? "skip" : type === "test:pass" ? "pass" : "fail",
          error: cause?.stack || cause?.message || error?.message || error?.cause || null
        }
      } else if (type === "test:pass" && data.skip) {
        // node:test does not emit child results for an entirely skipped suite.
        record = { kind: "skipped-suite", line: data.line, column: data.column }
      } else if (type === "test:fail" && details.error?.failureType !== "subtestsFailed") {
        record = {
          kind: "suite-failure",
          name: data.name,
          error: details.error?.cause?.stack || details.error?.cause?.message || "Suite failed"
        }
      }
    }

    if (record) {
      yield `ESM_SYNC_TEST_EVENT ${JSON.stringify(record)}\n`
    }
  }
}
