import type Entry from "../../entry.js"
import ENTRY from "../../constant/entry.js"

const { STATE_EXECUTION_COMPLETED } = ENTRY

function requestedDependencies(entry: Entry): Record<string, Entry> {
  if (entry.moduleRequests === null) return entry.children
  const children: Record<string, Entry> = Object.create(null) as Record<string, Entry>
  for (let index = 0; index < entry.moduleRequests.length; index++) {
    children[index] = entry.moduleRequests[index]!.entry
  }
  return children
}

// GatherAsynchronousTransitiveDependencies stops at the first TLA module on
// each path. Its ordinary evaluation then starts its own dependencies. A
// completed member of an unfinished async cycle still needs its cycle root.
function gatherAsynchronousDependencies(
  entry: Entry,
  result = new Map<Entry, Entry>(),
  seen = new Set<Entry>()
): Map<Entry, Entry> {
  if (seen.has(entry)) return result
  seen.add(entry)
  const record = entry.asyncEvaluation?.records.get(entry)
  const pendingCycle = record?.root != null && !record.root.done && !record.root.failed
  if ((entry.module.loaded || entry.state === STATE_EXECUTION_COMPLETED) && !pendingCycle)
    return result
  if (entry.compileData?.firstAwaitOutsideFunction != null) {
    result.set(entry, entry)
    return result
  }
  const children = requestedDependencies(entry)
  for (const name in children) gatherAsynchronousDependencies(children[name]!, result, seen)
  return result
}

function evaluationDependencies(entry: Entry): Record<string, Entry> {
  if (entry.moduleRequests === null) return entry.children
  const result = new Map<Entry, Entry>()
  for (const request of entry.moduleRequests) {
    if (request.deferred) gatherAsynchronousDependencies(request.entry, result)
    else result.set(request.entry, request.entry)
  }
  const children: Record<string, Entry> = Object.create(null) as Record<string, Entry>
  let index = 0
  result.forEach((child) => {
    children[index++] = child
  })
  return children
}

export { evaluationDependencies, gatherAsynchronousDependencies, requestedDependencies }
