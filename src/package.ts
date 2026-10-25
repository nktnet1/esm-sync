import type {
  PackageOptions,
  CJSOptions,
  CacheData,
  CompileData,
  CacheMeta
} from "./types/runtime.js"
import parseCacheMeta from "./parse/cache-meta.js"
import get from "./util/get.js"
interface PackageInfoState {
  forceOptions: unknown
  type: unknown
}
import { basename, dirname, resolve, sep } from "./safe/path.js"

import CHAR_CODE from "./constant/char-code.js"
import ENV from "./constant/env.js"
import ESM from "./constant/esm.js"
import PACKAGE from "./constant/package.js"

import GenericBuffer from "./generic/buffer.js"
import Loader from "./loader.js"

import assign from "./util/assign.js"
import builtinLookup from "./builtin-lookup.js"
import { cwd } from "./safe/process.js"
import defaults from "./util/defaults.js"
import emptyArray from "./util/empty-array.js"
import errors from "./errors.js"
import esmParseLoad from "./module/esm/parse-load.js"
import findPath from "./module/internal/find-path.js"
import getModuleDirname from "./util/get-module-dirname.js"
import has from "./util/has.js"
import isCacheName from "./util/is-cache-name.js"
import isExtJSON from "./path/is-ext-json.js"
import isFile from "./util/is-file.js"
import isObject from "./util/is-object.js"
import keys from "./util/keys.js"
import parseJSON from "./util/parse-json.js"
import parseJSON6 from "./util/parse-json6.js"
import readFile from "./fs/read-file.js"
import readJSON from "./fs/read-json.js"
import readJSON6 from "./fs/read-json6.js"
import readdir from "./fs/readdir.js"
import removeFile from "./fs/remove-file.js"
import setPrototypeOf from "./util/set-prototype-of.js"
import shared from "./shared.js"
import toStringLiteral from "./util/to-string-literal.js"
import { validRange } from "semver"

const { APOSTROPHE, DOT } = CHAR_CODE

const { OPTIONS } = ENV

const { PACKAGE_RANGE, PACKAGE_VERSION } = ESM

const { MODE_ALL, MODE_AUTO, MODE_STRICT, RANGE_ALL } = PACKAGE

const { ERR_INVALID_ESM_OPTION, ERR_UNKNOWN_ESM_OPTION } = errors

const ESMRC_FILENAME = ".esmrc"
const PACKAGE_JSON_FILENAME = "package.json"

const esmrcExts = [".mjs", ".cjs", ".js", ".json"]

const defaultOptions: PackageOptions = {
  await: false,
  cache: true,
  cjs: {
    cache: false,
    dedefault: false,
    esModule: false,
    extensions: false,
    mutableNamespace: false,
    namedExports: false,
    paths: false,
    topLevelReturn: false,
    vars: false
  },
  debug: false,
  force: false,
  mainFields: ["main"],
  mode: MODE_STRICT,
  sourceMap: void 0,
  wasm: false
}

const zeroConfigOptions = {
  cjs: {
    cache: true,
    dedefault: false,
    esModule: true,
    extensions: true,
    mutableNamespace: true,
    namedExports: true,
    paths: true,
    topLevelReturn: false,
    vars: true
  },
  mode: MODE_AUTO
}

class Package {
  declare cache: CacheData
  declare cachePath: string
  declare dirPath: string
  declare options: PackageOptions
  declare range: string
  static createOptions = createOptions
  static defaultOptions = defaultOptions

  declare static state: import("./types/runtime.js").LoaderState["package"]

  constructor(dirPath: string, range: string, value?: unknown) {
    const options = Package.createOptions(value)

    let cachePath = ""

    if (typeof options.cache === "string") {
      cachePath = resolve(dirPath, options.cache)
    } else if (options.cache !== false) {
      cachePath = dirPath + sep + "node_modules" + sep + ".cache" + sep + "esm"
    }

    const { dir } = shared.package

    if (!dir.has(cachePath)) {
      const cache = {} as CacheData

      let buffer: Buffer | null = null
      let compileDatas = new Map<string, CompileData | null>()
      let metas: Map<string, CacheMeta> | null = null

      if (cachePath !== "") {
        const cacheNames = readdir(cachePath)

        let hasBuffer = false
        let hasDirtyMarker = false
        let hasMetas = false

        for (const cacheName of cacheNames ?? []) {
          if (isCacheName(cacheName)) {
            // Later, we'll change the cached value to its associated compiler result,
            // but for now we merely register that a cache file exists.
            compileDatas.set(cacheName, null)
          } else if (cacheName.charCodeAt(0) === DOT) {
            if (cacheName === ".data.blob") {
              hasBuffer = true
            } else if (cacheName === ".data.json") {
              hasMetas = true
            } else if (cacheName === ".dirty") {
              hasDirtyMarker = true
              break
            }
          }
        }

        let isCacheInvalid = hasDirtyMarker
        let json: unknown = null

        if (hasMetas && !isCacheInvalid) {
          json = readJSON(cachePath + sep + ".data.json")

          isCacheInvalid =
            json === null ||
            !has(json, "version") ||
            get(json, "version") !== PACKAGE_VERSION ||
            !has(json, "meta") ||
            !isObject(get(json, "meta"))
        }

        if (isCacheInvalid) {
          hasBuffer = false
          hasMetas = false

          compileDatas = new Map()

          if (hasDirtyMarker) {
            removeFile(cachePath + sep + ".dirty")
          }

          clearBabelCache(cachePath)
        }

        if (hasBuffer) {
          buffer = readFile(cachePath + sep + ".data.blob")
        }

        if (hasMetas) {
          const jsonMeta = get(json, "meta") as Record<string, unknown>
          const cacheNames = keys(jsonMeta)

          metas = new Map()

          for (const cacheName of cacheNames ?? []) {
            const meta = parseCacheMeta(jsonMeta[cacheName])
            if (meta !== null) metas.set(cacheName, meta)
          }
        }
      }

      if (buffer === null) {
        buffer = GenericBuffer.alloc(0)
      }

      if (metas === null) {
        metas = new Map()
      }

      cache.buffer = buffer
      cache.compile = compileDatas
      cache.meta = metas

      dir.set(cachePath, cache)
    }

    this.cache = dir.get(cachePath)!
    this.cachePath = cachePath
    this.dirPath = dirPath
    this.options = options
    this.range = range
  }

  clone(): Package {
    const { options } = this
    const cjsOptions = options.cjs
    const cloned = assign({ __proto__: Package.prototype }, this) as unknown as Package
    const clonedOptions = assign({}, options)

    clonedOptions.cjs = assign({}, cjsOptions)
    cloned.options = clonedOptions

    return cloned as Package
  }

  static get(dirPath: string, forceOptions?: unknown): Package {
    if (dirPath === ".") {
      dirPath = cwd()
    }

    const pkgState = Loader.state.package
    const { cache } = pkgState

    if (dirPath === "" && !cache.has("")) {
      // Set `topLevelReturn` to `true` so that the "Illegal return statement"
      // syntax error will occur within the REPL.
      cache.set(
        "",
        new Package("", PACKAGE_RANGE, {
          cache: false,
          cjs: {
            topLevelReturn: true
          }
        })
      )
    }

    const result = getInfo(dirPath, {
      forceOptions,
      type: void 0
    })

    return result === null ? pkgState.default! : result
  }

  static from(request: unknown, forceOptions?: unknown): Package {
    let dirPath = "."

    if (typeof request === "string") {
      dirPath = builtinLookup.has(request) ? "" : dirname(request)
    } else {
      dirPath = getModuleDirname(request)
    }

    return Package.get(dirPath, forceOptions)
  }

  static set(dirPath: string, pkg: Package | null) {
    Loader.state.package.cache.set(dirPath, pkg)
  }
}

function clearBabelCache(cachePath: string) {
  const babelCachePath = resolve(cachePath, "../@babel/register")
  const cacheNames = readdir(babelCachePath)

  for (const cacheName of cacheNames ?? []) {
    if (isExtJSON(cacheName)) {
      removeFile(babelCachePath + sep + cacheName)
    }
  }
}

function createOptions(value?: unknown): PackageOptions {
  const { defaultOptions } = Package
  const names: string[] = []
  const options: Record<string, unknown> = {}

  if (typeof value === "string") {
    names.push("mode")
    options.mode = value
  } else {
    const possibleNames = keys(value)

    for (const name of possibleNames) {
      if (has(defaultOptions, name)) {
        names.push(name)
        options[name] = get(value, name)
      } else if (name === "sourcemap" && possibleNames.indexOf("sourceMap") === -1) {
        options.sourceMap = get(value, "sourcemap")
      } else {
        throw new ERR_UNKNOWN_ESM_OPTION(name)
      }
    }
  }

  if (names.indexOf("cjs") === -1) {
    options.cjs = zeroConfigOptions.cjs
  }

  if (names.indexOf("mode") === -1) {
    options.mode = zeroConfigOptions.mode
  }

  const cjsOptions = createOptionsCJS(options.cjs)

  defaults(options, defaultOptions)

  options.cjs = cjsOptions

  const awaitOption = options.await

  if (isFlag(awaitOption)) {
    options.await = !!awaitOption
  } else {
    throw new ERR_INVALID_ESM_OPTION("await", awaitOption)
  }

  const { cache } = options

  if (isFlag(cache)) {
    options.cache = !!cache
  } else if (typeof cache !== "string") {
    throw new ERR_INVALID_ESM_OPTION("cache", cache)
  }

  const { debug } = options

  if (isFlag(debug)) {
    options.debug = !!debug
  } else {
    throw new ERR_INVALID_ESM_OPTION("debug", debug)
  }

  const { force } = options

  if (isFlag(force)) {
    options.force = !!force
  } else {
    throw new ERR_INVALID_ESM_OPTION("force", cache)
  }

  const defaultMainFields = defaultOptions.mainFields

  let mainFields: unknown[] = Array.isArray(options.mainFields)
    ? options.mainFields
    : [options.mainFields]

  if (!Array.isArray(mainFields)) {
    mainFields = [mainFields]
  }

  if (mainFields === defaultMainFields) {
    mainFields = [defaultMainFields[0]!]
  } else {
    mainFields = Array.from(mainFields, (field) => {
      if (typeof field !== "string") {
        throw new ERR_INVALID_ESM_OPTION("mainFields", mainFields)
      }

      return field
    })
  }

  if (mainFields.indexOf("main") === -1) {
    mainFields.push("main")
  }

  options.mainFields = mainFields

  const { mode } = options

  if (mode === MODE_ALL || mode === "all") {
    options.mode = MODE_ALL
  } else if (mode === MODE_AUTO || mode === "auto") {
    options.mode = MODE_AUTO
  } else if (mode === MODE_STRICT || mode === "strict") {
    options.mode = MODE_STRICT
  } else {
    throw new ERR_INVALID_ESM_OPTION("mode", mode)
  }

  const { sourceMap } = options

  if (isFlag(sourceMap)) {
    options.sourceMap = !!sourceMap
  } else if (sourceMap !== void 0) {
    throw new ERR_INVALID_ESM_OPTION("sourceMap", sourceMap)
  }

  const wasmOption = options.wasm

  if (isFlag(wasmOption)) {
    options.wasm = !!wasmOption
  } else {
    throw new ERR_INVALID_ESM_OPTION("wasm", wasmOption)
  }

  return options as unknown as PackageOptions
}

function createOptionsCJS(value: unknown): CJSOptions {
  const defaultCJS = Package.defaultOptions.cjs
  const options: Record<string, unknown> = {}

  if (value === void 0) {
    return assign(options, defaultCJS) as CJSOptions
  }

  if (!isObject(value)) {
    const names = keys(defaultCJS)
    const optionsValue = !!value

    for (const name of names) {
      options[name] = isExplicitName(name) ? false : optionsValue
    }

    return options as unknown as CJSOptions
  }

  const names: string[] = []
  const possibleNames = keys(value)

  for (const name of possibleNames) {
    if (has(defaultCJS, name)) {
      names.push(name)
      options[name] = get(value, name)
    } else if (name === "interop" && possibleNames.indexOf("esModule") === -1) {
      options.esModule = value.interop
    } else {
      throw new ERR_UNKNOWN_ESM_OPTION("cjs[" + toStringLiteral(name, APOSTROPHE) + "]")
    }
  }

  let useZeroConfig = true

  for (const name of names) {
    const optionsValue = options[name]

    if (isFlag(optionsValue)) {
      const flagValue = !!optionsValue

      if (flagValue && !isExplicitName(name)) {
        useZeroConfig = false
      }

      options[name] = flagValue
    } else {
      throw new ERR_INVALID_ESM_OPTION(
        "cjs[" + toStringLiteral(name, APOSTROPHE) + "]",
        optionsValue,
        true
      )
    }
  }

  const defaultSource = useZeroConfig ? zeroConfigOptions.cjs : defaultCJS

  return defaults(options, defaultSource) as CJSOptions
}

function findRoot(dirPath: string): string {
  if (basename(dirPath) === "node_modules" || isFile(dirPath + sep + PACKAGE_JSON_FILENAME)) {
    return dirPath
  }

  const parentPath = dirname(dirPath)

  if (parentPath === dirPath) {
    return ""
  }

  return basename(parentPath) === "node_modules" ? dirPath : findRoot(parentPath)
}

function getInfo(dirPath: string, state: PackageInfoState): Package | null {
  const pkgState = Loader.state.package
  const { cache } = pkgState
  const defaultPkg = pkgState.default

  let pkg: Package | null = null

  if (cache.has(dirPath)) {
    pkg = cache.get(dirPath)!

    if (pkg !== null || state.forceOptions === void 0) {
      return pkg
    }
  }

  if (basename(dirPath) === "node_modules") {
    cache.set(dirPath, null)

    return null
  }

  if (defaultPkg && defaultPkg.options.force) {
    // Clone the default package to avoid the parsing phase fallback path
    // of module/internal/compile.
    pkg = defaultPkg.clone()
  } else {
    pkg = readInfo(dirPath, state)
  }

  if (pkg === null) {
    const parentPath = dirname(dirPath)

    if (parentPath !== dirPath) {
      pkg = getInfo(parentPath, state)
    }
  }

  cache.set(dirPath, pkg)

  return pkg
}

function getRange(json: unknown, name: string): string | null {
  if (has(json, name)) {
    const object = get(json, name)

    if (has(object, "esm")) {
      return validRange(get(object, "esm"))
    }
  }

  return null
}

function getRoot(dirPath: string): string {
  const { root } = shared.package

  let cached = root.get(dirPath)

  if (cached === void 0) {
    cached = findRoot(dirPath) || dirPath
    root.set(dirPath, cached)
  }

  return cached
}

function isExplicitName(name: string) {
  return name === "dedefault" || name === "topLevelReturn"
}

function isFlag(value: unknown): value is boolean | 0 | 1 {
  return typeof value === "boolean" || value === 0 || value === 1
}

function readInfo(dirPath: string, state: PackageInfoState): Package | null {
  let pkg: Package | undefined
  let optionsPath = dirPath + sep + ESMRC_FILENAME

  let options: unknown = isFile(optionsPath) ? readFile(optionsPath, "utf8") : null

  let optionsFound = options !== null

  if (optionsFound) {
    options = parseJSON6(options)
  } else {
    optionsPath = findPath(optionsPath, emptyArray, false, esmrcExts)
  }

  const { forceOptions } = state

  state.forceOptions = void 0

  if (optionsPath !== "" && !optionsFound) {
    optionsFound = true

    if (isExtJSON(optionsPath)) {
      options = readJSON6(optionsPath)
    } else {
      const { cache } = Loader.state.package
      const { moduleState } = shared
      const { parsing } = moduleState

      pkg = new Package(dirPath, RANGE_ALL, {
        cache: Package.createOptions(forceOptions).cache
      })

      moduleState.parsing = false
      cache.set(dirPath, pkg)

      try {
        pkg.options = Package.createOptions(esmParseLoad(optionsPath, null).module.exports)
      } finally {
        cache.set(dirPath, null)
        moduleState.parsing = parsing
      }
    }
  }

  const pkgPath = dirPath + sep + PACKAGE_JSON_FILENAME

  let pkgJSON: unknown = isFile(pkgPath) ? readFile(pkgPath, "utf8") : null

  let parentPkg: Package | null | undefined

  if (forceOptions === void 0 && pkgJSON === null) {
    if (optionsFound) {
      parentPkg = getInfo(dirname(dirPath), state)
    } else {
      return null
    }
  }

  let pkgParsed = 0

  if (pkgJSON !== null && !optionsFound) {
    pkgJSON = parseJSON(pkgJSON)
    pkgParsed = pkgJSON === null ? -1 : 1

    if (pkgParsed === 1 && !optionsFound && has(pkgJSON, "esm")) {
      optionsFound = true
      options = get(pkgJSON, "esm")
    }
  }

  let range: string | null = null

  if (forceOptions !== void 0) {
    range = RANGE_ALL
  } else if (parentPkg) {
    range = parentPkg.range
  } else {
    if (pkgParsed === 0 && pkgJSON !== null) {
      pkgJSON = parseJSON(pkgJSON)
      pkgParsed = pkgJSON === null ? -1 : 1
    }

    // A package.json may have `esm` in its "devDependencies" object because
    // it expects another package or application to enable ESM loading in
    // production, but needs `esm` during development.
    if (pkgParsed === 1) {
      range = getRange(pkgJSON, "dependencies") || getRange(pkgJSON, "peerDependencies")
    }

    if (range === null) {
      if (optionsFound || getRange(pkgJSON, "devDependencies")) {
        range = RANGE_ALL
      } else {
        return null
      }
    }
  }

  if (pkg !== void 0) {
    pkg.range = range
    return pkg
  }

  if (forceOptions !== void 0 && !optionsFound) {
    optionsFound = true
    options = forceOptions
  }

  if (options === true || !optionsFound) {
    optionsFound = true
    options = OPTIONS
  }

  if (pkgParsed !== 1 && pkgJSON === null) {
    dirPath = getRoot(dirPath)
  }

  return new Package(dirPath, range, options)
}

setPrototypeOf(Package.prototype, null)

export default Package
