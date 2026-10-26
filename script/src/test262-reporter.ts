"use strict"

import { Transform, type TransformCallback } from "node:stream"
import { inspect, styleText } from "node:util"
import type { TestEvent } from "node:test/reporters"

const rule = "-".repeat(58)
const totals = /^(?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+\S+$/

type ResultEvent = Extract<TestEvent, { type: "test:pass" | "test:fail" }>

function caseLocation(name: string): { group: string; name: string; description?: string } {
  const match = /\((test\/language\/(.+\.js))\)$/.exec(name)
  if (!match) return { group: "Runner", name }

  const segments = match[2]!.split("/")
  const depth = segments.length > 2 ? 2 : 1
  return {
    group: segments.slice(0, depth).join(" / "),
    name: segments.slice(depth).join("/"),
    description: name.slice(0, match.index).trim()
  }
}

function statusOf(event: ResultEvent): "PASS" | "FAIL" | "SKIP" | "TODO" {
  if (event.type === "test:fail") return "FAIL"
  if (event.data.skip) return "SKIP"
  if (event.data.todo) return "TODO"
  return "PASS"
}

function colouredStatus(status: ReturnType<typeof statusOf>): string {
  const color =
    status === "PASS" ? "green" : status === "FAIL" ? "red" : status === "SKIP" ? "yellow" : "cyan"
  return styleText(color, status)
}

function duration(milliseconds: number): string {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)}ms`
    : `${(milliseconds / 1000).toFixed(2)}s`
}

function errorDetails(error: Error & { cause?: unknown }): string {
  const underlying = error.cause instanceof Error ? error.cause : error
  return inspect(underlying, { colors: false, depth: 4 })
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n")
}

// Node's built-in spec reporter colours entire result lines. This reporter
// uses the same native test events, but styles only the status and heading
// tokens, with paths grouped for more readable Test262 output.
class Test262Reporter extends Transform {
  private group: string | undefined

  constructor() {
    super({ writableObjectMode: true })
  }

  override _transform(
    event: TestEvent,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    try {
      switch (event.type) {
        case "test:stdout":
        case "test:stderr":
          this.push(event.data.message)
          break

        case "test:enqueue":
          if (event.data.type === "suite" && event.data.nesting === 0) {
            this.push(`\n  ${styleText("cyan", "TEST262")}  ${event.data.name}\n  ${rule}\n`)
          }
          break

        case "test:pass":
        case "test:fail": {
          if (event.data.details.type === "suite") {
            // The actual failing test has already been reported. Avoid repeating
            // its error when Node marks the enclosing suite as failed.
            if (
              event.type === "test:pass" ||
              ("failureType" in event.data.details.error &&
                event.data.details.error.failureType === "subtestsFailed")
            )
              break
          }

          const location = caseLocation(event.data.name)
          if (location.group !== this.group) {
            this.group = location.group
            this.push(
              `\n  ${this.group}\n  ${"-".repeat(Math.max(14, location.group.length + 2))}\n`
            )
          }

          const status = statusOf(event)
          this.push(
            `    ${colouredStatus(status)}  ${location.name}  (${duration(event.data.details.duration_ms)})${typeof event.data.skip === "string" ? `  ${event.data.skip}` : ""}\n`
          )

          if (event.type === "test:fail") {
            if (location.description) this.push(`      ${location.description}\n`)
            this.push(`${errorDetails(event.data.details.error)}\n`)
          }
          break
        }

        case "test:diagnostic":
          // Node also emits the final counts as diagnostics; the compact
          // summary below renders them once, while other messages stay visible.
          if (event.data.nesting === 0 && totals.test(event.data.message)) break
          this.push(`  ${event.data.level.toUpperCase()}  ${event.data.message}\n`)
          break

        case "test:log":
          this.push(`  ${event.data.message}\n`)
          break

        case "test:interrupted":
          for (const test of event.data.tests)
            this.push(`  ${styleText("red", "INTERRUPTED")}  ${test.name}\n`)
          break

        case "test:summary": {
          if (event.data.file !== undefined) break
          // Older @types/node declarations omit `failed`, although Node includes
          // it in the summary payload on all supported runtime versions.
          const { counts } = event.data
          const failed =
            "failed" in counts && typeof counts.failed === "number"
              ? counts.failed
              : counts.tests - counts.passed - counts.skipped - counts.todo - counts.cancelled
          this.push(`\n  ${styleText("cyan", "RESULTS")}\n  ${rule}\n`)
          this.push(
            `    ${styleText("green", "PASS")} ${counts.passed}    ${styleText("red", "FAIL")} ${failed}    ${styleText("yellow", "SKIP")} ${counts.skipped}    ${styleText("cyan", "TODO")} ${counts.todo}\n`
          )
          this.push(
            `    ${counts.tests} tests  /  ${counts.suites} suites  /  ${counts.cancelled} cancelled  /  ${duration(event.data.duration_ms)}\n\n`
          )
          break
        }
      }
      callback()
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

// Custom Node test reporters must be the module's default export. Tooling
// sources are emitted as CommonJS for compatibility with the test runner.
export = Test262Reporter
