import { execFileSync } from "node:child_process"
import test262NodeFlags = require("./test262-node-flags.js")

interface CaseInfo {
  relativePath: string
  skippedReason?: string | undefined
  features?: string[] | undefined
  expectedPhase?: string | undefined
}
interface GrammarCase extends CaseInfo {
  source: string
  flags?: Record<string, boolean> | undefined
  includes?: string[] | undefined
  expectedError?: string | undefined
}
interface CaseResult {
  path: string
  status: string
  unsupportedFeatureSources?: { host?: string[]; loader?: string[] }
  [key: string]: unknown
}
interface ReportInput {
  revision: string
  selected: number
  excluded: number
  results: CaseResult[]
  runtime?: string
  platform?: string
}
;("use strict")

// Test262 generates syntax-valid script examples by embedding ImportCall in
// different grammar positions. A generated case with no observable assertions
// tests *parsing*, not asynchronous module resolution. Executing such a case
// can trigger an unobserved rejected import promise which Node treats as a
// fatal unhandled rejection. Never classify arbitrary syntax/valid cases this
// way: some generated templates assert on the value returned by import().
function isGeneratedGrammarCase({
  relativePath,
  flags = {},
  source,
  includes = [],
  expectedError,
  expectedPhase
}: GrammarCase): boolean {
  const normalizedPath = relativePath.replaceAll("\\", "/")
  const prefix = "test/language/expressions/dynamic-import/syntax/valid/"

  if (
    !normalizedPath.startsWith(prefix) ||
    !flags.generated ||
    flags.async ||
    flags.module ||
    includes.length !== 0 ||
    expectedError !== undefined ||
    expectedPhase !== undefined
  ) {
    return false
  }

  const bodyOffset = source.indexOf("---*/")
  if (bodyOffset === -1) return false

  // Restrict to the pinned generator's grammar templates. If Test262 changes
  // the templates, fail conservatively and execute the test instead.
  if (
    !/^\/\/ - src\/dynamic-import\/syntax\/valid\/[^\r\n]+\.template$/m.test(
      source.slice(0, bodyOffset)
    )
  ) {
    return false
  }

  // In particular, the generated `with (import(...))` examples have actual
  // Promise assertions. They must still run, as must any future generated
  // syntax tests which add an assertion or an explicit throw.
  const body = source.slice(bodyOffset + 5)
  return !/\bassert\b|\$DONE\b|\bthrow\b/.test(body)
}

async function detectHostFeatures(): Promise<Record<string, boolean>> {
  // The runner itself need not have --harmony. Probe in a fresh process using
  // the actual worker flags rather than accidentally skipping supported cases.
  const result: unknown = JSON.parse(
    execFileSync(
      process.execPath,
      [...test262NodeFlags, require.resolve("./test262-host-probe.js")],
      { encoding: "utf8", timeout: 10_000 }
    )
  )
  if (result === null || typeof result !== "object") {
    throw new Error("Invalid Test262 host capability probe result")
  }
  const record = result as Record<string, unknown>
  if (Object.values(record).some((value) => typeof value !== "boolean")) {
    throw new Error("Invalid Test262 host capability probe result")
  }
  return result as Record<string, boolean>
}

// These are loader capabilities, independent of the host's engine features.
function detectLoaderFeatures() {
  return { "source-phase-imports-module-source": true, "import-bytes": true }
}

function getUnsupportedFeatures(
  features: readonly string[],
  hostFeatures: Record<string, boolean>
): string[] {
  return features.filter(
    (feature) =>
      Object.prototype.hasOwnProperty.call(hostFeatures, feature) && !hostFeatures[feature]
  )
}

// Both module- and script-goal imports run through esm-sync's import runtime.
// Text modules therefore do not require Node's native import-text support.
function getUnsupportedHostFeatures(
  { features }: { features: string[] },
  hostFeatures: Record<string, boolean>
): string[] {
  const requiredFeatures = features.filter((feature) => feature !== "import-text")
  return getUnsupportedFeatures(requiredFeatures, hostFeatures)
}

// The ModuleSource feature tag also occurs on syntax-only cases which do
// not read module source bindings. Keep those parsing cases runnable even
// when a loader cannot provide a ModuleSource value at runtime.
function getUnsupportedLoaderFeatures(
  {
    features,
    relativePath,
    expectedPhase
  }: { features: string[]; relativePath: string; expectedPhase?: string | undefined },
  loaderFeatures: Record<string, boolean>
): string[] {
  const syntaxOnly =
    expectedPhase === "parse" || relativePath.replaceAll("\\", "/").split("/").includes("syntax")
  const requiredFeatures = syntaxOnly
    ? features.filter((feature) => feature !== "source-phase-imports-module-source")
    : features
  return getUnsupportedFeatures(requiredFeatures, loaderFeatures)
}

function selectCases<T extends CaseInfo>(
  cases: readonly T[],
  {
    filter = "",
    limit,
    excludeFeatures = []
  }: { filter?: string; limit?: number; excludeFeatures?: string[] } = {}
): T[] {
  const pathFilter = filter.trim().replaceAll("\\", "/").toLowerCase()

  if (
    !Array.isArray(excludeFeatures) ||
    excludeFeatures.some((feature) => typeof feature !== "string" || feature.trim() === "")
  ) {
    throw new TypeError("Test262 excluded features must be non-empty strings")
  }
  const excludedFeatures = new Set(excludeFeatures.map((feature) => feature.trim()))

  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new RangeError("Test262 limit must be a positive integer")
  }

  const pathMatches = cases.filter(
    ({ relativePath, skippedReason }) =>
      skippedReason === undefined &&
      relativePath.replaceAll("\\", "/").toLowerCase().includes(pathFilter)
  )
  const matches = pathMatches.filter(
    ({ features = [] }) => !features.some((feature) => excludedFeatures.has(feature))
  )

  if (matches.length === 0) {
    throw new Error(
      pathMatches.length === 0
        ? pathFilter
          ? `No runnable Test262 cases match the path filter: ${filter}`
          : "No runnable Test262 cases remain after applying the skiplist"
        : "No runnable Test262 cases remain after applying feature filters"
    )
  }

  return limit === undefined ? matches : matches.slice(0, limit)
}

function failureGroup(relativePath: string): string {
  const parts = relativePath.replaceAll("\\", "/").split("/")
  const start = parts[0] === "test" && parts[1] === "language" ? 2 : 0
  return parts.slice(start, -1).slice(0, 2).join("/") || "(root)"
}

function createReport({
  revision,
  selected,
  excluded,
  results,
  runtime = process.version,
  platform = process.platform
}: ReportInput) {
  const entries = [...results].sort((left, right) => left.path.localeCompare(right.path))
  const failuresByGroup: Record<string, number> = {}

  for (const entry of entries) {
    if (entry.status !== "fail") continue
    const group = failureGroup(entry.path)
    failuresByGroup[group] = (failuresByGroup[group] ?? 0) + 1
  }

  const failures = Object.fromEntries(
    Object.entries(failuresByGroup).sort(([left], [right]) => left.localeCompare(right))
  )

  return {
    schemaVersion: 1,
    revision,
    runtime,
    platform,
    selected,
    excluded,
    passed: entries.filter(({ status }) => status === "pass").length,
    failed: entries.filter(({ status }) => status === "fail").length,
    unsupported: entries.filter(({ status }) => status === "unsupported").length,
    unsupportedByOrigin: {
      host: entries.filter(
        ({ status, unsupportedFeatureSources }) =>
          status === "unsupported" && (unsupportedFeatureSources?.host?.length ?? 0) > 0
      ).length,
      loader: entries.filter(
        ({ status, unsupportedFeatureSources }) =>
          status === "unsupported" && (unsupportedFeatureSources?.loader?.length ?? 0) > 0
      ).length
    },
    complete: entries.length === selected,
    failuresByGroup: failures,
    cases: entries
  }
}

export = {
  isGeneratedGrammarCase,
  selectCases,
  createReport,
  detectHostFeatures,
  detectLoaderFeatures,
  getUnsupportedFeatures,
  getUnsupportedHostFeatures,
  getUnsupportedLoaderFeatures
}
