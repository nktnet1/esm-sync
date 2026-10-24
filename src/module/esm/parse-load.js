import ENTRY from "../../constant/entry.js"

import load from "./load.js"
import { isAsyncEvaluating } from "../internal/async-graph.js"
import { asyncError } from "../internal/sync-await.js"
import shared from "../../shared.js"
import validateDeep from "./validate-deep.js"

const { STATE_PARSING_COMPLETED, TYPE_CJS } = ENTRY

function parseLoad(request, parent, isMain, linkOnly = false) {
  const { moduleState } = shared

  const previousParsing = moduleState.parsing
  moduleState.requireDepth += 1
  try {
    moduleState.parsing = true
    let entry = load(request, parent, isMain)
    moduleState.parsing = false

    // A public esmRequire performs a linking lookup first. That lookup must
    // not bypass the execution-time guard and return an in-flight namespace.
    if (!linkOnly && entry.asyncEvaluation !== null && isAsyncEvaluating(entry, true)) {
      throw asyncError(
        "ERR_ESM_SYNC_ASYNC_REENTRANT",
        "Cannot expose exports from an evaluating async module"
      )
    }
    entry.updateBindings()

    if (entry.state === STATE_PARSING_COMPLETED) {
      if (entry.type !== TYPE_CJS) {
        validateDeep(entry)
      }

      if (!linkOnly) {
        entry = load(request, parent, isMain)
      }
    }
    return entry
  } finally {
    moduleState.parsing = previousParsing
    moduleState.requireDepth -= 1
  }
}

export default parseLoad
