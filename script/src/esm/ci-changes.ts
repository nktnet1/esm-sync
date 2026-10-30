import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { styleText } from "node:util"
import { runtimeTests } from "../../../config/test-suites.ts"

export interface CIPlan {
  library: boolean
  tooling: boolean
  production: boolean
  audit: boolean
}

interface ChangeEvent {
  before?: string
  after?: string
  pull_request?: { base: { sha: string }; head: { sha: string } }
}

export const fullPlan: Readonly<CIPlan> = Object.freeze({
  library: true,
  tooling: true,
  production: true,
  audit: true
})

const runtimeFiles = new Set(runtimeTests)
const toolingFiles = new Set(["biome.json", "knip.json", "lefthook.yaml", ".ncurc.mjs"])
const dependencyFiles = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
const checkNames = Object.keys(fullPlan) as (keyof CIPlan)[]

export function classifyChanges(files: readonly string[]): CIPlan {
  const plan: CIPlan = { library: false, tooling: false, production: false, audit: false }
  for (const filename of files) {
    if (/\.md$/i.test(filename) || filename.startsWith("docs/")) continue

    plan.tooling = true
    if (dependencyFiles.has(filename)) return { ...fullPlan }
    if (toolingFiles.has(filename)) continue

    if (filename.startsWith("test/vitest/") && filename.endsWith(".test.ts")) {
      if (runtimeFiles.has(filename)) plan.library = plan.production = true
      // Vitest assigns new, unclassified test files to the tooling project.
      continue
    }

    if (
      filename === "script/src/esm/ci-changes.ts" ||
      /^script\/src\/benchmark-/.test(filename) ||
      filename === "script/src/verify-babel-repro.ts"
    ) {
      continue
    }

    if (
      /^script\/src\/esm\/(?:release-|prepare-release-|publish-release-)/.test(filename) ||
      /^script\/src\/(?:publish|package-manifest|package-smoke|test-packed|test-verdaccio)\.ts$/.test(
        filename
      ) ||
      /^\.github\/workflows\/(?:release|publish)\.yaml$/.test(filename)
    ) {
      plan.production = true
      continue
    }

    if (filename.startsWith(".github/codeql/") || filename === ".github/workflows/codeql.yaml") {
      continue
    }

    // Build/harness inputs and unknown paths fail open to the full matrix.
    // This includes src/, native/, config/, fixture changes, public shims and
    // declarations, shared test helpers, and newly introduced build scripts.
    plan.library = plan.production = true
  }
  return plan
}

function commit(value: string | undefined): string {
  if (typeof value !== "string" || !/^[a-f\d]{40,64}$/i.test(value) || /^0+$/.test(value)) {
    throw new Error("Missing or invalid comparison commit")
  }
  return value
}

export function changedFiles(
  eventName: string,
  event: ChangeEvent,
  ref: string,
  cwd: string,
  force = false
): string[] | null {
  // Reusable release calls retain the caller's push event. Tag and manual
  // runs must never inherit a documentation-only or partial-test decision.
  if (
    force ||
    ref.startsWith("refs/tags/") ||
    eventName === "workflow_dispatch" ||
    eventName === "workflow_call"
  ) {
    return null
  }

  let range: string
  if (eventName === "pull_request") {
    range = `${commit(event.pull_request?.base.sha)}...${commit(event.pull_request?.head.sha)}`
  } else if (eventName === "push") {
    range = `${commit(event.before)}..${commit(event.after)}`
  } else {
    throw new Error(`Unrecognised CI event: ${eventName}`)
  }

  // NUL delimiters preserve spaces/newlines. Disabling rename detection
  // includes both old and new paths, including moves out of runtime suites.
  const output = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", range, "--"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024
  })
  return output.split("\0").filter(Boolean)
}

function main(): void {
  let plan: CIPlan
  try {
    const event: ChangeEvent = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8"))
    const files = changedFiles(
      process.env.GITHUB_EVENT_NAME ?? "",
      event,
      process.env.GITHUB_REF ?? "",
      process.cwd(),
      process.env.ESM_CI_FULL === "true"
    )
    plan = files === null ? { ...fullPlan } : classifyChanges(files)
  } catch (error) {
    console.warn(
      `${styleText("yellow", "Fallback")}: running all checks (${error instanceof Error ? error.message : String(error)})`
    )
    plan = { ...fullPlan }
  }
  const output = checkNames.map((name) => `${name}=${plan[name]}\n`).join("")
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output)
  for (const name of checkNames) {
    const enabled = plan[name]
    console.log(`${name}: ${styleText(enabled ? "green" : "dim", enabled ? "run" : "skip")}`)
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main()
}
