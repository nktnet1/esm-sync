"use strict"

// Each native suite executes once, but Vitest needs its individual results.
// Structured node:test events avoid scraping human-readable TAP/spec output.
import type { TestEvent } from "node:test/reporters"

// Error.cause is deliberately unknown in Node's public event types.
function errorDetail(value: unknown): unknown {
  if (value === null || typeof value !== "object") return undefined
  const detail = value as { stack?: unknown; message?: unknown }
  return detail.stack || detail.message
}

async function* reporter(
  source: AsyncIterable<TestEvent, void, unknown>
): AsyncGenerator<string, void, unknown> {
  for await (const { type, data } of source) {
    let record: Record<string, unknown> | undefined

    if (type === "test:summary") {
      record = { kind: "summary", counts: data.counts, success: data.success }
    } else if (type === "test:pass" || type === "test:fail") {
      const { details } = data
      const error = ("error" in details ? details.error : undefined) as
        | (Error & { failureType?: string })
        | undefined

      if (details.type === "test") {
        const cause = error?.cause

        record = {
          kind: "test",
          name: data.name,
          line: data.line,
          column: data.column,
          status: data.skip ? "skip" : type === "test:pass" ? "pass" : "fail",
          error: errorDetail(cause) || error?.message || error?.cause || null
        }
      } else if (type === "test:pass" && data.skip) {
        // node:test does not emit child results for an entirely skipped suite.
        record = { kind: "skipped-suite", line: data.line, column: data.column }
      } else if (type === "test:fail" && error?.failureType !== "subtestsFailed") {
        record = {
          kind: "suite-failure",
          name: data.name,
          error: errorDetail(error?.cause) || "Suite failed"
        }
      }
    }

    if (record) {
      yield `ESM_SYNC_TEST_EVENT ${JSON.stringify(record)}\n`
    }
  }
}
export = reporter
