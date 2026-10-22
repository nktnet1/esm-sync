"use strict"

const { spawn } = require("node:child_process")
const path = require("node:path")
const { styleText } = require("node:util")
const { Command, InvalidArgumentError } = require("commander")

function positiveInteger(value) {
  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("must be a positive integer")
  }

  return parsed
}

const program = new Command()
program
  .name("test262")
  .description("Run the prepared Test262 corpus against esm-sync")
  .option("--filter <path>", "include paths containing this text (case-insensitive)")
  .option(
    "--exclude-feature <feature>",
    "exclude Test262 cases tagged with this feature (repeatable)",
    (feature, features) => [...features, feature],
    []
  )
  .option("--limit <count>", "run at most this many matching cases", positiveInteger)
  .option("--report <file>", "write a machine-readable JSON result report")
  .option("--reporter <name>", "Node test reporter: spec, dot, or tap", "spec")
  .parse(process.argv)

const options = program.opts()

if (!["spec", "dot", "tap"].includes(options.reporter)) {
  program.error("--reporter must be spec, dot, or tap")
}

if (options.filter !== undefined && options.filter.trim() === "") {
  program.error("--filter must not be empty")
}
if (options.excludeFeature.some((feature) => feature.trim() === "")) {
  program.error("--exclude-feature must not be empty")
}

const rootPath = path.resolve(__dirname, "..")
const testPath = path.join(rootPath, "test/test262.mjs")
const env = {
  ...process.env,
  TEST262_FILTER: options.filter ?? "",
  TEST262_EXCLUDE_FEATURES: JSON.stringify(options.excludeFeature),
  TEST262_LIMIT: options.limit === undefined ? "" : String(options.limit),
  TEST262_REPORT: options.report === undefined ? "" : path.resolve(options.report)
}

if (options.filter) console.info(`Test262 path filter: ${styleText("cyan", options.filter)}`)
if (options.excludeFeature.length > 0) {
  console.info(
    `Test262 excluding features: ${styleText("cyan", options.excludeFeature.join(", "))}`
  )
}
if (options.limit) console.info(`Test262 case limit: ${styleText("cyan", String(options.limit))}`)
if (options.report) console.info(`Test262 JSON report: ${styleText("cyan", env.TEST262_REPORT)}`)

const child = spawn(process.execPath, ["--test", `--test-reporter=${options.reporter}`, testPath], {
  cwd: rootPath,
  env,
  stdio: "inherit"
})

child.once("error", (error) => {
  console.error(error)
  process.exitCode = 1
})
child.once("close", (code, signal) => {
  if (signal) console.error(`Test262 runner terminated by signal ${signal}`)
  process.exitCode = code ?? 1
})
