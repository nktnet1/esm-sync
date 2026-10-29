import type { ModuleRecord } from "../../types/runtime.js"
// Based on `Module._resolveFilename()`.
// Copyright Node.js contributors. Released under MIT license:
// https://github.com/nodejs/node/blob/master/lib/internal/modules/cjs/loader.js

import ENTRY from "../../constant/entry.js"
import ENV from "../../constant/env.js"

import Entry from "../../entry.js"
import Loader from "../../loader.js"
import Module from "../../module.js"
import RealModule from "../../real/module.js"
import SafeModule from "../../safe/module.js"

import builtinLookup from "../../builtin-lookup.js"
import bundledLookup from "../../bundled-lookup.js"
import { dirname } from "../../safe/path.js"
import errors from "../../errors.js"
import { resolveSelfExports } from "../internal/package-exports.js"
import isAbsolute from "../../path/is-absolute.js"
import isObject from "../../util/is-object.js"
import isRelative from "../../path/is-relative.js"
import maskFunction from "../../util/mask-function.js"
import maskStackTrace from "../../error/mask-stack-trace.js"
import shared from "../../shared.js"
import staticFindPath from "./find-path.js"
import staticResolveLookupPaths from "./resolve-lookup-paths.js"
import validateString from "../../util/validate-string.js"

import realRequire from "../../real/require.js"

const { TYPE_CJS, TYPE_PSEUDO } = ENTRY

const { ELECTRON } = ENV

const { MODULE_NOT_FOUND } = errors

const resolveFilename = maskFunction(function (
  this: unknown,
  request: string,
  parent: ModuleRecord | null | undefined = void 0,
  isMain: boolean = false,
  options: { paths?: string[] } | undefined = void 0
) {
  validateString(request, "request")

  if (request.startsWith("node:")) {
    request = request.substr(5)
  }

  // Electron and Muon patch `Module._resolveFilename()`.
  // https://github.com/electron/electron/blob/master/lib/common/reset-search-paths.js
  // https://github.com/brave/muon/blob/master/lib/common/reset-search-paths.js
  if (ELECTRON && bundledLookup.has(request)) {
    return SafeModule._resolveFilename(request, parent, isMain, options)
  }

  if (builtinLookup.has(request)) {
    return request
  }

  const isAbs = isAbsolute(request)
  const parentEntry = Entry.get(parent)

  if (parentEntry !== null) {
    parentEntry.updateFilename()
  }

  let fromPath: string | null

  if (isAbs) {
    fromPath = dirname(request)
  } else {
    fromPath = parentEntry === null ? "" : parentEntry.dirname
  }

  let cache: Map<string, string> | undefined
  let cacheKey: string | undefined

  if (!isObject(options)) {
    cache = shared.memoize.moduleStaticResolveFilename

    cacheKey = request + "\0" + fromPath + "\0" + (isMain ? "1" : "")

    const cached = cache.get(cacheKey)

    if (cached !== void 0) {
      return cached
    }
  }

  const isRel = !isAbs && isRelative(request)
  const isPath = isAbs || isRel

  let paths: string[] | null

  if (
    isPath &&
    Module._findPath === staticFindPath &&
    Module._resolveLookupPaths === staticResolveLookupPaths
  ) {
    paths = [fromPath!]
  } else if (cache === void 0 && Array.isArray(options?.paths)) {
    paths = resolveLookupPathsFrom(request, options!.paths)
  } else {
    paths = Module._resolveLookupPaths(request, parent, true)
  }

  let foundPath: string | false =
    (!isPath && resolveSelfExports(request, fromPath!, "require", isMain)) ||
    Module._findPath(request, paths ?? [], isMain)

  if (foundPath === false) {
    foundPath = ""

    // If our custom resolution logic fails, fall back to node's built-in
    // resolution, which better covers some other cases (e.g. export maps).
    try {
      foundPath = realRequire.resolve(request, { paths: paths ?? [] })
    } catch (_e) {}
  }

  if (foundPath !== "") {
    if (cache !== void 0) {
      cache.set(cacheKey!, foundPath)
    }

    return foundPath
  }

  const error = MODULE_NOT_FOUND(request, parent)

  if (!Loader.state.package.default!.options.debug) {
    const maskOptions = {
      filename: null as string | null,
      inModule: false
    }

    if (parentEntry !== null) {
      const parentType = parentEntry.type

      maskOptions.filename = parentEntry.filename

      maskOptions.inModule =
        (!parentEntry.package.options.cjs.paths || parentEntry.extname === ".mjs") &&
        parentType !== TYPE_CJS &&
        parentType !== TYPE_PSEUDO
    }

    maskStackTrace(error, maskOptions)
  }

  throw error
}, RealModule._resolveFilename)

function resolveLookupPathsFrom(request: string, fromPaths: string[]) {
  const fakeParent = new Module("")
  const paths: string[] = []

  for (const fromPath of fromPaths) {
    fakeParent.paths = Module._nodeModulePaths(fromPath)

    const lookupPaths = Module._resolveLookupPaths(request, fakeParent, true)

    for (const lookupPath of lookupPaths ?? []) {
      if (paths.indexOf(lookupPath) === -1) {
        paths.push(lookupPath)
      }
    }
  }

  return paths
}

export default resolveFilename
