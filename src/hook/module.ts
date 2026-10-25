import type { ModuleRecord, ModuleConstructor } from "../types/runtime.js"
type ExtensionCompiler = (this: unknown, mod: ModuleRecord, filename: string) => unknown
import Reflect from "../reflection.js"
import ENTRY from "../constant/entry.js"
import ENV from "../constant/env.js"
import ESM from "../constant/esm.js"
import PACKAGE from "../constant/package.js"

import Entry from "../entry.js"
import Loader from "../loader.js"
import Module from "../module.js"
import Package from "../package.js"
import RealModule from "../real/module.js"
import Wrapper from "../wrapper.js"

import compile from "../module/internal/compile.js"
import errors from "../errors.js"
import get from "../util/get.js"
import getLocationFromStackTrace from "../error/get-location-from-stack-trace.js"
import has from "../util/has.js"
import isError from "../util/is-error.js"
import isStackTraceMaskable from "../util/is-stack-trace-maskable.js"
import maskFunction from "../util/mask-function.js"
import maskStackTrace from "../error/mask-stack-trace.js"
import readFile from "../fs/read-file.js"
import relaxRange from "../util/relax-range.js"
import toString from "../util/to-string.js"
import satisfies from "../util/satisfies.js"
import setProperty from "../util/set-property.js"
import setPrototypeOf from "../util/set-prototype-of.js"
import shared from "../shared.js"
import toExternalError from "../util/to-external-error.js"
import toExternalFunction from "../util/to-external-function.js"

const { STATE_EXECUTION_COMPLETED, STATE_EXECUTION_STARTED, STATE_INITIAL } = ENTRY

const { OPTIONS } = ENV

const { PACKAGE_VERSION } = ESM

const { MODE_ALL, MODE_AUTO, RANGE_ALL } = PACKAGE

const { ERR_REQUIRE_ESM } = errors

const exts = [".js", ".json", ".mjs", ".cjs", ".wasm"]
const importExportRegExp = /^.*?\b(?:im|ex)port\b/
const realExtsJS = RealModule._extensions[".js"]!

function hook(Mod: ModuleConstructor, parent?: unknown) {
  const { _extensions } = Mod
  const passthruMap = new Map<unknown, boolean>()

  let parentPkg = Package.from(parent)

  if (parentPkg === null) {
    parentPkg = Package.from(parent, OPTIONS || true)
  }

  const defaultPkg = parentPkg.clone()
  const defaultOptions = defaultPkg.options

  defaultPkg.range = RANGE_ALL

  if (!defaultOptions.force && defaultOptions.mode === MODE_ALL) {
    defaultOptions.mode = MODE_AUTO
  }

  Loader.state.package.default = defaultPkg
  Module._extensions = _extensions

  const jsManager = createManager(".js")

  function createManager(ext: string) {
    return function managerWrapper(
      this: unknown,
      manager: ExtensionCompiler,
      func: ExtensionCompiler,
      args: [ModuleRecord, string]
    ) {
      const [, filename] = args
      const pkg = Package.from(filename)
      const wrapped = Wrapper.find(_extensions, ext, relaxRange(pkg.range))

      return wrapped === null
        ? tryPassthru.call(this, func, args, pkg)
        : Reflect.apply(wrapped, this, [manager, func, args])
    }
  }

  function jsWrapper(
    this: unknown,
    manager: ExtensionCompiler,
    func: ExtensionCompiler,
    args: [ModuleRecord, string]
  ) {
    const [mod, filename] = args
    const shouldOverwrite = !Entry.has(mod)
    const entry = Entry.get(mod)
    const ext = entry.extname
    const pkg = entry.package

    const compileFallback = (content?: string) => {
      entry.state = STATE_EXECUTION_STARTED

      if (typeof content === "string") {
        const { _compile } = mod
        const shouldRestore = has(mod, "_compile")

        setProperty(
          mod,
          "_compile",
          toExternalFunction(function (
            this: ModuleRecord,
            _ignoredContent: string,
            filename: string
          ) {
            if (shouldRestore) {
              setProperty(this, "_compile", _compile)
            } else {
              Reflect.deleteProperty(this, "_compile")
            }

            return Reflect.apply(_compile, this, [content, filename])
          })
        )
      }

      let result: unknown
      let threw = true

      try {
        result = tryPassthru.call(this, func, args, pkg)
        threw = false
      } finally {
        entry.state = threw ? STATE_INITIAL : STATE_EXECUTION_COMPLETED
      }

      return result
    }

    if (shouldOverwrite) {
      setPrototypeOf(mod, Module.prototype)
    }

    if (entry._passthruCompile || (shouldOverwrite && ext === ".mjs")) {
      entry._passthruCompile = false
      return compileFallback()
    }

    const { compileData } = entry

    if ((compileData !== null && compileData.code !== null) || ext === ".json" || ext === ".wasm") {
      entry._ranthruCompile = true
      compile(manager, entry, null, filename, compileFallback)
      return
    }

    if (this === Loader.state.module.extensions) {
      entry._ranthruCompile = true
      compile(manager, entry, readFile(filename, "utf8"), filename, compileFallback)
      return
    }

    const { _compile } = mod
    const shouldRestore = shouldOverwrite && has(mod, "_compile")

    const compileWrapper = toExternalFunction(function (
      this: ModuleRecord,
      content: string,
      filename: string
    ) {
      if (shouldOverwrite) {
        if (shouldRestore) {
          setProperty(this, "_compile", _compile)
        } else {
          Reflect.deleteProperty(this, "_compile")
        }
      }

      const compileWrapper = has(this, shared.symbol._compile)
        ? Reflect.get(this, shared.symbol._compile)
        : null

      if (typeof compileWrapper === "function") {
        Reflect.deleteProperty(this, shared.symbol._compile)
        Reflect.apply(compileWrapper, this, [content, filename])
      } else {
        compile(manager, entry, content, filename, compileFallback)
      }
    })

    if (shouldOverwrite) {
      setProperty(mod, "_compile", compileWrapper)
    } else {
      entry._ranthruCompile = true

      Reflect.defineProperty(mod, shared.symbol._compile, {
        configurable: true,
        value: compileWrapper
      })
    }

    // `mode: all` forces even syntax-free .js files to be modules. Delegating
    // their zero-transform load to Node's extension handler can execute them
    // as CommonJS (or execute their bodies during the linking pass).
    if (
      !(ext === ".js" && pkg.options.mode === MODE_ALL) &&
      (compileData === null || compileData.transforms === 0) &&
      passthruMap.get(func)
    ) {
      return tryPassthru.call(this, func, args, pkg)
    }

    mod._compile(readFile(filename, "utf8")!, filename)
  }

  for (const ext of exts) {
    const extIsMJS = ext === ".mjs"

    if (extIsMJS && !has(_extensions, ext)) {
      _extensions[ext] = maskFunction(mjsCompiler, realExtsJS)
    }

    const extIsWASM = ext === ".wasm"

    if (extIsWASM && !shared.support.wasm) {
      continue
    }

    if (!has(_extensions, ext)) {
      _extensions[ext] = realExtsJS
    }

    const extCompiler = Wrapper.unwrap(_extensions, ext)

    let passthru = typeof extCompiler === "function" && !has(extCompiler, shared.symbol.mjs)

    if (extIsMJS && passthru) {
      try {
        Reflect.apply(extCompiler, void 0, [])
      } catch (e) {
        if (isError(e) && e.code === "ERR_REQUIRE_ESM") {
          passthru = false
        }
      }
    }

    Wrapper.manage(_extensions, ext, jsManager)
    Wrapper.wrap(_extensions, ext, jsWrapper)

    passthruMap.set(extCompiler, passthru)
    Loader.state.module.extensions[ext] = _extensions[ext]!
  }
}

function mjsCompiler(_mod: ModuleRecord, filename: string): never {
  throw new ERR_REQUIRE_ESM(filename)
}

function tryPassthru(
  this: unknown,
  func: ExtensionCompiler,
  args: [ModuleRecord, string],
  pkg: Package
): unknown {
  let error: unknown

  try {
    return Reflect.apply(func, this, args)
  } catch (e) {
    error = e
  }

  if (Loader.state.package.default!.options.debug || !isStackTraceMaskable(error)) {
    toExternalError(error)

    throw error
  }

  const name = get(error, "name")

  let [, filename] = args

  if (name === "SyntaxError") {
    const message = toString(get(error, "message"))
    const { range } = pkg

    if (importExportRegExp.test(message) && !satisfies(PACKAGE_VERSION, range)) {
      const newMessage =
        "Expected esm@" + range + ". Using esm@" + PACKAGE_VERSION + ": " + filename

      Reflect.defineProperty(error as object, "message", {
        configurable: true,
        value: newMessage,
        writable: true
      })

      const stack = get(error, "stack")

      if (typeof stack === "string") {
        Reflect.defineProperty(error as object, "stack", {
          configurable: true,
          value: stack.replace(message, () => newMessage),
          writable: true
        })
      }
    }

    pkg.cache.dirty = true
  }

  const loc = getLocationFromStackTrace(error)

  if (loc !== null) {
    filename = loc.filename
  }

  maskStackTrace(error, { filename })

  throw error
}

Reflect.defineProperty(mjsCompiler, shared.symbol.mjs, {
  value: true
})

export default hook
