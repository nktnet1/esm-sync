import type { ModuleRecord } from "../../types/runtime.js"
import Reflect from "../../reflection.js"
import ENTRY from "../../constant/entry.js"

import Entry from "../../entry.js"
import Loader from "../../loader.js"
import Module from "../../module.js"
import Package from "../../package.js"

import _load from "../internal/load.js"
import builtinLookup from "../../builtin-lookup.js"
import { dirname } from "../../safe/path.js"
import dualResolveFilename from "../internal/dual-resolve-filename.js"
import getURLFromFilePath from "../../util/get-url-from-file-path.js"
import getURLQueryFragment from "../../util/get-url-query-fragment.js"
import has from "../../util/has.js"
import isExtMJS from "../../path/is-ext-mjs.js"
import loader from "./loader.js"
import realProcess from "../../real/process.js"
import resolveFilename from "./resolve-filename.js"
import setProperty from "../../util/set-property.js"
import shared from "../../shared.js"
import toExternalFunction from "../../util/to-external-function.js"

const { TYPE_CJS, TYPE_PSEUDO } = ENTRY

function load(
  request: string,
  parent: ModuleRecord | null | undefined,
  isMain: boolean = false,
  preload: ((entry: Entry) => void) | undefined = void 0,
  deferErrored = false
) {
  const { parsing } = shared.moduleState
  const parentEntry = Entry.get(parent)
  const parentCJS = parentEntry === null ? null : parentEntry.package.options.cjs
  const parentIsMJS = parentEntry === null ? false : parentEntry.extname === ".mjs"
  const parentType = parentEntry === null ? -1 : parentEntry.type

  let filename: string

  if (parentEntry !== null && parentCJS!.paths && !parentIsMJS) {
    filename = dualResolveFilename(request, parent, isMain)
  } else {
    filename = resolveFilename(request, parent, isMain)
  }

  const fromPath = dirname(filename)

  if (fromPath === "." && builtinLookup.has(filename)) {
    request = filename
  }

  const pkg = Package.from(filename)
  const { cjs } = pkg.options
  const queryFragment = getURLQueryFragment(request)
  const { moduleCache, scratchCache } = Loader.state.module

  let cache = Module._cache
  let isUnexposed = !cjs.cache

  request = queryFragment === "" ? filename : getURLFromFilePath(filename) + queryFragment

  if (isExtMJS(filename) || has(moduleCache, request)) {
    cache = moduleCache
  } else if (parsing) {
    cache = scratchCache
  } else if (has(scratchCache, request)) {
    const mod = scratchCache[request]!

    if (isUnexposed && Entry.get(mod).type !== TYPE_CJS) {
      cache = moduleCache
    }

    cache[request] = mod
    Reflect.deleteProperty(scratchCache, request)
  }

  // Normal imports rethrow cached evaluation failures immediately. Deferred
  // imports may still link those modules, but must rethrow the exact cached
  // failure only when their deferred namespace is accessed.
  if (deferErrored) {
    const descriptor = Reflect.getOwnPropertyDescriptor(cache, request)
    const cachedEntry = descriptor?.value === void 0 ? null : Entry.get(descriptor.value)
    const failedEntry =
      descriptor?.get?.erroredEntry ||
      (cachedEntry !== null && has(cachedEntry, "evaluationError") ? cachedEntry : void 0)

    if (failedEntry !== void 0) {
      if (parentEntry !== null) {
        parentEntry.children[failedEntry.name!] = failedEntry
        parentEntry._lastChild = failedEntry
      }
      if (typeof preload === "function") {
        preload(failedEntry)
      }
      return failedEntry
    }
  }

  let loaderCalled = false

  const sanitize = (entry: Entry) => {
    const isCJS = entry.type === TYPE_CJS

    if (isCJS) {
      isUnexposed = false
    }

    if (isMain && isUnexposed) {
      Reflect.deleteProperty(realProcess, "mainModule")
    }

    if (
      isCJS &&
      parentEntry !== null &&
      (parentIsMJS || (parentType !== TYPE_CJS && parentType !== TYPE_PSEUDO && !parentCJS!.cache))
    ) {
      try {
        entry.module.parent = void 0
      } catch {
        /* jest freezes module */
      }
    }
  }

  const entry = _load(request, parent, isMain, cache, (entry) => {
    loaderCalled = true

    cache[request] = entry.module

    if (parentEntry !== null) {
      parentEntry.children[entry.name!] = entry
    }

    if (!parsing) {
      sanitize(entry)
    }

    if (typeof preload === "function") {
      preload(entry)
    }

    tryLoader(entry, filename, parentEntry, cache, request)
  })

  if (parsing) {
    sanitize(entry)
  }

  if (!loaderCalled && typeof preload === "function") {
    preload(entry)
  }

  if (parentEntry !== null) {
    parentEntry._lastChild = entry
  }

  return entry
}

function tryLoader(
  entry: Entry,
  filename: string,
  parentEntry: Entry | null,
  cache: Record<string, ModuleRecord>,
  cacheKey: string
) {
  let error: unknown
  let threw = true

  try {
    loader(entry, filename, parentEntry)
    threw = false
  } catch (e) {
    error = e
    throw error
  } finally {
    if (threw) {
      if (entry.type !== TYPE_CJS) {
        // Unlike CJS, for other module types errors are preserved for
        // subsequent loads.
        const getCachedError: (() => never) & { erroredEntry?: Entry } = toExternalFunction(
          function () {
            throw error
          }
        )

        // A completed linking pass followed by a failed evaluation can be
        // reused by import defer; parse/link failures still reject on import.
        if (
          Object.prototype.hasOwnProperty.call(entry, "evaluationError") &&
          entry.evaluationError === error
        ) {
          getCachedError.erroredEntry = entry
        }

        Reflect.defineProperty(cache, cacheKey, {
          configurable: true,
          enumerable: true,
          get: getCachedError,
          set: toExternalFunction(function (this: object, value: unknown) {
            setProperty(this, cacheKey, value)
          })
        })
      } else {
        Reflect.deleteProperty(cache, cacheKey)
      }
    }
  }
}

export default load
