import type { ModuleRecord } from "../../types/runtime.js"
import type { SetterArgs } from "../../types/runtime-state.js"
import ENTRY from "../../constant/entry.js"

import Entry from "../../entry.js"
import Module from "../../module.js"

import dualResolveFilename from "../internal/dual-resolve-filename.js"
import { isPackageExportsRequest, isPackageExportsError } from "../internal/package-exports.js"
import resolveLookupPaths from "../internal/resolve-lookup-paths.js"
import errors from "../../errors.js"
import esmLoad from "./load.js"
import isError from "../../util/is-error.js"
import isPath from "../../util/is-path.js"
import importValue from "./import-value.js"
import { resolve } from "../../safe/path.js"
import shared from "../../shared.js"
import validateDeep from "./validate-deep.js"
import validateShallow from "./validate-shallow.js"

const { ERR_INVALID_ESM_FILE_EXTENSION } = errors

const { TYPE_CJS, TYPE_ESM, STATE_PARSING_COMPLETED, UPDATE_TYPE_INIT } = ENTRY

function esmImport(
  request: string,
  parentEntry: Entry,
  setterArgsList: SetterArgs,
  isDynamic = false,
  moduleType: string | undefined = void 0
) {
  if (moduleType === "text" || moduleType === "bytes") {
    return importValue(request, parentEntry, setterArgsList, moduleType)
  }

  const { moduleState } = shared
  const { parsing } = moduleState
  const previousChildren = isDynamic
    ? new Set(Object.keys(parentEntry.children).map((name) => parentEntry.children[name]))
    : null

  let entry: Entry | null = null
  let finalizeCalled = false

  const addChild = (entry: Entry, childEntry: Entry, name = childEntry.name!): void => {
    if (!isDynamic) {
      entry.children[name] = childEntry
      if (
        entry.moduleRequests !== null &&
        !entry.moduleRequests.some((request) => !request.deferred && request.entry === childEntry)
      ) {
        entry.moduleRequests.push({ entry: childEntry, deferred: false })
      }
    }
    childEntry.addSetters(setterArgsList, entry)
  }

  const finalize = () => {
    if (finalizeCalled) {
      return
    }

    finalizeCalled = true

    const exported = tryRequire(request, parentEntry)

    if (entry === null) {
      entry = getEntryFrom(request, exported, parentEntry)
      addChild(parentEntry, entry)
    } else if (!Object.is(entry.module.exports, exported)) {
      const { name } = entry

      entry = getEntryFrom(request, exported, parentEntry)
      addChild(parentEntry, entry, name!)
    }

    entry.loaded()
    entry.updateBindings(null, UPDATE_TYPE_INIT)

    validateShallow(entry, parentEntry)
  }

  const preload = (entry: Entry) => addChild(parentEntry, entry)

  if (isDynamic || parsing) {
    if (isDynamic) {
      moduleState.parsing = true
    }

    try {
      entry = tryLoad(request, parentEntry, preload)
    } finally {
      if (isDynamic) {
        moduleState.parsing = false
        for (const name in parentEntry.children) {
          if (!previousChildren!.has(parentEntry.children[name])) delete parentEntry.children[name]
        }
      }
    }

    if (entry !== null) {
      entry.updateBindings()

      if (isDynamic && entry.state === STATE_PARSING_COMPLETED && entry.type !== TYPE_CJS) {
        validateDeep(entry)
      }
    }
  } else {
    entry = tryLoad(request, parentEntry, preload)
  }

  if (parsing) {
    if (entry === null) {
      const exported = tryRequire(request, parentEntry)

      entry = getEntryFrom(request, exported, parentEntry)
      addChild(parentEntry, entry)
    }

    entry._finalize = finalize
  }

  if (
    parentEntry.extname === ".mjs" &&
    entry !== null &&
    entry.type === TYPE_ESM &&
    entry.extname !== ".mjs" &&
    !isPackageExportsRequest(
      request,
      parentEntry.dirname!,
      resolveLookupPaths(request, parentEntry.module, true) ?? []
    )
  ) {
    throw new ERR_INVALID_ESM_FILE_EXTENSION(entry.module)
  }

  if (!parsing) {
    finalize()
  }
  return entry
}

function getEntryFrom(request: string, exported: unknown, parentEntry: Entry) {
  const { _lastChild } = parentEntry

  if (_lastChild !== null && Object.is(_lastChild.module.exports, exported)) {
    return _lastChild
  }

  const filename = tryDualResolveFilename(request, parentEntry.module)
  const mod = new Module(filename)

  mod.exports = exported
  mod.loaded = true

  if (isPath(filename)) {
    mod.filename = filename
  }

  return Entry.get(mod)
}

function tryDualResolveFilename(
  request: string,
  parent: ModuleRecord | null | undefined,
  isMain: boolean = false
) {
  try {
    return dualResolveFilename(request, parent, isMain)
  } catch {}

  if (isPath(request)) {
    const parentFilename = parent?.filename

    return typeof parentFilename === "string" ? resolve(parentFilename, request) : resolve(request)
  }

  return request
}

function tryLoad(
  request: string,
  parentEntry: Entry,
  preload: ((entry: Entry) => void) | undefined = void 0
) {
  const { moduleState } = shared

  moduleState.requireDepth += 1

  let entry: Entry | undefined
  let error: unknown
  let threw = true

  try {
    entry = esmLoad(request, parentEntry.module, false, preload)
    threw = false
  } catch (e) {
    error = e
  }

  moduleState.requireDepth -= 1

  if (!threw) {
    return entry!
  }

  if (isPackageExportsError(error)) throw error

  if (parentEntry.extname === ".mjs" || !isError(error)) {
    throw error
  }

  const { code } = error

  if (code !== "ERR_INVALID_PROTOCOL" && code !== "MODULE_NOT_FOUND") {
    throw error
  }

  return null
}

function tryRequire(request: string, parentEntry: Entry) {
  parentEntry._passthruRequire = true

  try {
    return parentEntry.module.require(request)
  } finally {
    parentEntry._passthruRequire = false
  }
}

export default esmImport
