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

// Text imports are a Node host capability, not an esm-sync loader feature.
// Exercise the host's actual import-attribute handling instead of inferring
// support from the Node version or from the existence of an experimental flag.
async function supportsNativeTextImports() {
  try {
    const specifier = "data:application/json,%22test262-text-probe%22"
    await import(specifier, { with: { type: "text" } })
    return true
  } catch (error) {
    // These errors mean the host cannot load this resource as a text module.
    // Other failures (including unexpected loader errors) must not be hidden
    // by an unsupported classification.
    if (
      (error as { code?: unknown } | null)?.code === "ERR_IMPORT_ATTRIBUTE_UNSUPPORTED" ||
      (error as { code?: unknown } | null)?.code === "ERR_UNKNOWN_MODULE_FORMAT"
    ) {
      return false
    }
    throw error
  }
}

// Test262 feature tags describe engine capabilities, not promises made by the
// loader. Probe only capabilities whose absence is known to invalidate cases.
async function detectHostFeatures() {
  const immutableDescriptor = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "immutable")
  const immutableArrayBuffer =
    typeof immutableDescriptor?.get === "function" &&
    typeof Reflect.get(ArrayBuffer.prototype, "transferToImmutable") === "function"

  let nonextensiblePrivate = false
  try {
    // Using Function keeps the runner parseable on engines without private
    // fields, and tests the operation used by Test262, not just syntax.
    const addPrivateField = new Function(
      "target",
      "class Marker extends function (value) { return value } { #brand = true }; return new Marker(target)"
    )
    const target = new Proxy(Object.preventExtensions(Object.create(null) as object), {})
    addPrivateField(target)
  } catch (error) {
    nonextensiblePrivate = error instanceof TypeError
  }

  return {
    "immutable-arraybuffer": immutableArrayBuffer,
    "nonextensible-applies-to-private": nonextensiblePrivate,
    "import-text": await supportsNativeTextImports()
  }
}

// Source-phase imports can be parsed, and unsupported runtime requests can
// reject correctly, but esm-sync does not expose a ModuleSource object. This
// loader capability is intentionally separate from native V8/Node features.
// Update the declaration when the loader implements ModuleSource bindings.
function detectLoaderFeatures() {
  return { "source-phase-imports-module-source": false }
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
// though the loader cannot provide a ModuleSource value at runtime.
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
