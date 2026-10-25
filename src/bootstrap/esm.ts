import type { ModuleConstructor, ModuleRecord, SharedState } from "../types/runtime.js"
import type { ScriptOptions } from "node:vm"

const NativeModule = require("module") as ModuleConstructor
NativeModule.Module._extensions[".js"] = function (module, filename) {
  module._compile(
    (require("fs") as typeof import("node:fs")).readFileSync(filename, "utf8"),
    filename
  )
}

const globalThis = (function (this: typeof global | void): typeof global {
  // Reference `this` before `Function()` to prevent CSP errors for unsafe-eval.
  // Fallback to `Function()` when Node is invoked with `--strict`.
  return this || (Function("return this")() as typeof global)
})()

const { apply } = Reflect
const defineProperty: (
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor & { __proto__: null }
) => boolean = Reflect.defineProperty

const { freeze } = Object
const { hasOwnProperty } = Object.prototype
const symbolFor = Symbol.for
const { type, versions } = process as NodeJS.Process & { type?: string }

const { filename, id, parent } = module

const isElectron = has(versions, "electron")
const isElectronRenderer = isElectron && type === "renderer"

let nativeContent = ""

if (typeof id === "string" && id.startsWith("internal/")) {
  nativeContent = getNativeSource("internal/esm/loader")
}

const Module = NativeModule
const { Script } = require("vm") as typeof import("node:vm")

const { createCachedData, runInNewContext, runInThisContext } = Script.prototype

const { resolve, sep } = require("path") as typeof import("node:path")
const { readFileSync } = require("fs") as typeof import("node:fs")

const esmModule = new Module(id)

esmModule.filename = filename
esmModule.parent = parent as ModuleRecord | null | undefined

function getNativeSource(thePath: string): string {
  let result: unknown

  try {
    const { internalBinding } = require("internal/bootstrap/loaders") as {
      internalBinding(name: string): Record<string, unknown>
    }
    const natives = internalBinding("natives")

    if (has(natives, thePath)) {
      result = natives[thePath]
    }
  } catch (_e) {}

  return typeof result === "string" ? result : ""
}

function has(object: unknown, name: PropertyKey): boolean {
  return object != null && apply(hasOwnProperty, object, [name])
}

function loadESM(): unknown {
  compiledESM(require, esmModule, shared)
  return esmModule.exports
}

function makeRequireFunction(
  mod: NodeJS.Module,
  options?: Parameters<typeof import("../../index.js")>[1]
): NodeJS.Require {
  // The private bootstrap exports shared state once, then the public factory.
  return (loadESM() as typeof import("../../index.js"))(mod, options)
}

function readFile(filename: string): Buffer | null
function readFile(filename: string, options: "utf8"): string | null
function readFile(filename: string, options?: "utf8"): Buffer | string | null {
  try {
    return options === undefined ? readFileSync(filename) : readFileSync(filename, options)
  } catch (_e) {}

  return null
}

let cachedData: Buffer | undefined
let scriptOptions: ScriptOptions & { __proto__: null }
let cachePath = ""
let content = ""

if (nativeContent !== "") {
  content = nativeContent

  scriptOptions = {
    __proto__: null,
    filename: "esm.js"
  }
} else {
  // Keep bootstrap and compiler cache data together at the package root even
  // though the generated bootstrap itself lives in dist/.
  cachePath = resolve(__dirname, "..", "node_modules/.cache/esm")
  cachedData = readFile(cachePath + sep + ".data.blob") ?? undefined
  content = readFile(__dirname + sep + "esm" + sep + "loader.js", "utf8") ?? ""

  scriptOptions = {
    __proto__: null,
    ...(cachedData === undefined ? {} : { cachedData }),
    filename,
    produceCachedData: typeof createCachedData !== "function"
  }
}

const script = new Script(
  "const __global__ = this;" + "(function (require, module, __shared__) { " + content + "\n});",
  scriptOptions
)

type CompiledLoader = (
  require: NodeJS.Require,
  module: ModuleRecord,
  shared: SharedState | undefined
) => void
let compiledESM: CompiledLoader

if (isElectronRenderer) {
  compiledESM = apply(runInThisContext, script, [
    {
      __proto__: null,
      filename
    }
  ])
} else {
  compiledESM = apply(runInNewContext, script, [
    {
      __proto__: null,
      global: globalThis
    },
    {
      __proto__: null,
      filename
    }
  ])
}

// Declare `shared` before assignment to avoid the TDZ.
let shared: SharedState | undefined

shared = loadESM() as SharedState

if (cachePath !== "") {
  const { dir } = shared.package

  let cache = dir.get(cachePath)

  if (cache === void 0) {
    const scriptData = cachedData ?? null

    cache = {
      buffer: cachedData,
      compile: new Map([
        [
          "esm",
          {
            circular: 0,
            code: null,
            codeWithTDZ: null,
            filename: null,
            firstAwaitOutsideFunction: null,
            firstReturnOutsideFunction: null,
            mtime: -1,
            scriptData,
            sourceType: 1,
            transforms: 0,
            yieldIndex: -1
          }
        ]
      ]),
      meta: new Map()
    }

    dir.set(cachePath, cache)
  }

  const { pendingScripts } = shared

  let scripts = pendingScripts.get(cachePath)

  if (scripts === void 0) {
    scripts = new Map()
    pendingScripts.set(cachePath, scripts)
  }

  scripts.set("esm", script)
}

// The legacy symbol used for `esm` export detection.
defineProperty(makeRequireFunction, shared.symbol.package, {
  __proto__: null,
  value: true
})

defineProperty(makeRequireFunction, shared.customInspectKey!, {
  __proto__: null,
  value: () => "esm enabled"
})

defineProperty(makeRequireFunction, symbolFor("esm:package"), {
  __proto__: null,
  value: true
})

freeze(makeRequireFunction)

export default makeRequireFunction
