import type { ModuleRecord } from "../../types/runtime.js"
import Reflect from "../../reflection.js"
// Based on `Module._load()`.
// Copyright Node.js contributors. Released under MIT license:
// https://github.com/nodejs/node/blob/master/lib/internal/modules/cjs/loader.js

import ENTRY from "../../constant/entry.js"

import Entry from "../../entry.js"
import GenericArray from "../../generic/array.js"
import Loader from "../../loader.js"
import Module from "../../module.js"

import builtinEntries from "../../builtin-entries.js"
import { isAsyncEvaluating } from "./async-graph.js"
import { asyncError } from "./sync-await.js"
import getFilePathfromURL from "../../util/get-file-path-from-url.js"
import has from "../../util/has.js"
import isFileOrigin from "../../util/is-file-origin.js"
import realProcess from "../../real/process.js"
import setProperty from "../../util/set-property.js"
import shared from "../../shared.js"
import toExternalFunction from "../../util/to-external-function.js"

const { STATE_EXECUTION_COMPLETED, STATE_PARSING_COMPLETED } = ENTRY

function load(
  filename: string,
  parent: ModuleRecord | null | undefined,
  isMain: boolean = false,
  cache: Record<string, ModuleRecord>,
  loader: (entry: Entry) => void
) {
  const loaderModuleState = Loader.state.module
  const { parsing } = shared.moduleState

  let entry: Entry
  let mod = cache[filename]

  if (mod === void 0 && cache === loaderModuleState.scratchCache) {
    mod = Module._cache[filename]
  }

  const foundMod = mod !== void 0

  if (foundMod) {
    const children = parent != null && parent.children

    if (Array.isArray(children) && GenericArray.indexOf(children, mod) === -1) {
      GenericArray.push(children, mod)
    }

    entry = Entry.get(mod!)

    // Completed entries have no outstanding async evaluation. Preserve the
    // hot synchronous cache path without inspecting graph state or errors.
    if (entry.state === STATE_EXECUTION_COMPLETED && entry.asyncEvaluation === null) return entry

    if (has(entry, "evaluationError")) throw entry.evaluationError
    const evaluation = shared.moduleState.asyncEvaluation
    const dynamicLookup =
      shared.moduleState.asyncImport && (evaluation == null || evaluation.executing === null)
    if (!parsing && !dynamicLookup && isAsyncEvaluating(entry)) {
      if (evaluation == null || !evaluation.importing || evaluation.executing !== null) {
        throw asyncError(
          "ERR_ESM_SYNC_ASYNC_REENTRANT",
          "Cannot expose exports from an evaluating async module"
        )
      }
    }

    if (parsing || mod!.loaded || entry.state !== STATE_PARSING_COMPLETED) {
      return entry
    }
  } else if (has(builtinEntries, filename)) {
    return builtinEntries[filename]!
  } else {
    mod = new Module(filename, parent)

    mod.filename = isFileOrigin(filename) ? getFilePathfromURL(filename) : filename

    entry = Entry.get(mod!)

    if (isMain) {
      mod.id = "."
      loaderModuleState.mainModule = mod
      realProcess.mainModule = mod
    }
  }

  const { compileData } = entry
  const ext = entry.extname

  if (
    foundMod ||
    (compileData !== null && compileData.code !== null) ||
    ext === ".json" ||
    ext === ".wasm"
  ) {
    loader(entry)

    return entry
  }

  const { _compile } = mod!
  const shouldRestore = has(mod, "_compile")

  setProperty(
    mod,
    "_compile",
    toExternalFunction(function (this: ModuleRecord, content: string, filename: string) {
      if (shouldRestore) {
        setProperty(this, "_compile", _compile)
      } else {
        Reflect.deleteProperty(this, "_compile")
      }

      const compileWrapper = has(this, shared.symbol._compile)
        ? Reflect.get(this, shared.symbol._compile)
        : null

      let compile = _compile

      if (typeof compileWrapper === "function") {
        compile = compileWrapper as typeof compile
        Reflect.deleteProperty(this, shared.symbol._compile)
      }

      return Reflect.apply(compile, this, [content, filename])
    })
  )

  loader(entry)

  return entry
}

export default load
