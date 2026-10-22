"use strict"

// Test262 feature tags describe engine capabilities, not promises made by the
// loader. Probe only capabilities whose absence is known to invalidate cases.
function detectHostFeatures() {
  const immutableDescriptor = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "immutable")
  const immutableArrayBuffer =
    typeof immutableDescriptor?.get === "function" &&
    typeof ArrayBuffer.prototype.transferToImmutable === "function"

  let nonextensiblePrivate = false
  try {
    // Using Function keeps the runner parseable on engines without private
    // fields, and tests the operation used by Test262, not just syntax.
    const addPrivateField = new Function(
      "target",
      "class Marker extends function (value) { return value } { #brand = true }; return new Marker(target)"
    )
    const target = new Proxy(Object.preventExtensions(Object.create(null)), {})
    addPrivateField(target)
  } catch (error) {
    nonextensiblePrivate = error instanceof TypeError
  }

  return {
    "immutable-arraybuffer": immutableArrayBuffer,
    "nonextensible-applies-to-private": nonextensiblePrivate
  }
}

function getUnsupportedFeatures(features, hostFeatures) {
  return features.filter(
    (feature) =>
      Object.prototype.hasOwnProperty.call(hostFeatures, feature) && !hostFeatures[feature]
  )
}

function selectCases(cases, { filter = "", limit } = {}) {
  const pathFilter = filter.trim().replaceAll("\\", "/").toLowerCase()

  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new RangeError("Test262 limit must be a positive integer")
  }

  const matches = cases.filter(
    ({ relativePath, skippedReason }) =>
      skippedReason === undefined &&
      relativePath.replaceAll("\\", "/").toLowerCase().includes(pathFilter)
  )

  if (matches.length === 0) {
    throw new Error(
      pathFilter
        ? `No runnable Test262 cases match the path filter: ${filter}`
        : "No runnable Test262 cases remain after applying the skiplist"
    )
  }

  return limit === undefined ? matches : matches.slice(0, limit)
}

function failureGroup(relativePath) {
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
}) {
  const entries = [...results].sort((left, right) => left.path.localeCompare(right.path))
  const failuresByGroup = {}

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
    complete: entries.length === selected,
    failuresByGroup: failures,
    cases: entries
  }
}

module.exports = { selectCases, createReport, detectHostFeatures, getUnsupportedFeatures }
