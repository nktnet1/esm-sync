import type { ModuleRecord } from "../../types/runtime.js"
import ENTRY from "../../constant/entry.js"

import load from "./load.js"
import { isAsyncEvaluating } from "../internal/async-graph.js"
import { asyncError } from "../internal/sync-await.js"
import shared from "../../shared.js"
import validateDeep from "./validate-deep.js"

const {
  LOAD_COMPLETED,
  NAMESPACE_FINALIZATION_COMPLETED,
  STATE_EXECUTION_COMPLETED,
  STATE_PARSING_COMPLETED,
  TYPE_CJS,
  TYPE_ESM
} = ENTRY

function parseLoad(
  request: string,
  parent: ModuleRecord | null | undefined,
  isMain: boolean = false,
  linkOnly = false
) {
  const { moduleState } = shared

  const previousParsing = moduleState.parsing
  moduleState.requireDepth += 1
  try {
    moduleState.parsing = true
    let entry = load(request, parent, isMain, void 0, false, "require")
    moduleState.parsing = false

    // A public esmRequire performs a linking lookup first. That lookup must
    // not bypass the execution-time guard and return an in-flight namespace.
    if (!linkOnly && entry.asyncEvaluation !== null && isAsyncEvaluating(entry, true)) {
      throw asyncError(
        "ERR_ESM_SYNC_ASYNC_REENTRANT",
        "Cannot expose exports from an evaluating async module"
      )
    }
    // Fully evaluated, non-circular ESM exports are read through live getter
    // proxies, and assignments propagate via runtime.updateBindings(). A cache
    // hit does not need to re-evaluate every exported getter. Retain the
    // original refresh for CJS interop, cycles and in-flight evaluations.
    if (
      entry.type !== TYPE_ESM ||
      entry.state !== STATE_EXECUTION_COMPLETED ||
      entry._loaded !== LOAD_COMPLETED ||
      entry._namespaceFinalized !== NAMESPACE_FINALIZATION_COMPLETED ||
      entry.circular ||
      entry.asyncEvaluation !== null
    ) {
      entry.updateBindings()
    }

    if (entry.state === STATE_PARSING_COMPLETED) {
      if (entry.type !== TYPE_CJS) {
        validateDeep(entry)
      }

      if (!linkOnly) {
        entry = load(request, parent, isMain, void 0, false, "require")
      }
    }
    return entry
  } finally {
    moduleState.parsing = previousParsing
    moduleState.requireDepth -= 1
  }
}

export default parseLoad
