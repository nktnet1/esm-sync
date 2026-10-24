import ENTRY from "../../constant/entry.js"

const { STATE_EXECUTION_COMPLETED } = ENTRY

function requestedDependencies(entry) {
  if (entry.moduleRequests === null) return entry.children
  const children = { __proto__: null }
  for (let index = 0; index < entry.moduleRequests.length; index++) {
    children[index] = entry.moduleRequests[index].entry
  }
  return children
}

// GatherAsynchronousTransitiveDependencies stops at the first TLA module on
// each path. Its ordinary evaluation then starts its own dependencies. A
// completed member of an unfinished async cycle still needs its cycle root.
function gatherAsynchronousDependencies(entry, result = new Map(), seen = new Set()) {
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
  for (const name in children) gatherAsynchronousDependencies(children[name], result, seen)
  return result
}

function evaluationDependencies(entry) {
  if (entry.moduleRequests === null) return entry.children
  const result = new Map()
  for (const request of entry.moduleRequests) {
    if (request.deferred) gatherAsynchronousDependencies(request.entry, result)
    else result.set(request.entry, request.entry)
  }
  const children = { __proto__: null }
  let index = 0
  result.forEach((child) => {
    children[index++] = child
  })
  return children
}

export { evaluationDependencies, gatherAsynchronousDependencies, requestedDependencies }
