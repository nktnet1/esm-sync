const { readFileSync } = require("node:fs")
const path = require("node:path")
const vm = process.getBuiltinModule("node:vm")

// The compiler bundle normally receives this binding from esm-sync's loader.
// The standalone Test262 phase checker needs the same compiler configuration.
let compiler

function getCompiler() {
  if (compiler) return compiler

  // Load the already-built compiler as CommonJS even when the Test262 case
  // itself forces esm-sync's global `mode:all` module setting.
  const { Module } = require("node:module")
  const filename = path.resolve(__dirname, "../../build/compiler.js")
  const bundle = readFileSync(filename, "utf8")
  const nativeModule = new Module(filename, module)
  nativeModule.filename = filename
  nativeModule.paths = Module._nodeModulePaths(path.dirname(filename))
  globalThis.__global__ ??= globalThis
  const run = new vm.Script(Module.wrap(bundle), { filename }).runInThisContext()
  run(nativeModule.exports, nativeModule.require.bind(nativeModule), nativeModule, filename, path.dirname(filename))
  compiler = nativeModule.exports
  return compiler
}

function parseTest(filename, isModule) {
  const source = readFileSync(filename, "utf8")

  // esm-sync's compiler deliberately tolerates some early errors (including
  // duplicate lexical declarations, invalid labels and private names). Check
  // the compiled text against the engine grammar without evaluating it.
  // Validate *after* esm-sync transforms import/export syntax: the host parser
  // may not support valid `import defer` or `import.source()` source text.
  const sourceType = isModule ? 2 : 1
  const compiled = getCompiler().compile(source, {
    hint: sourceType,
    pragmas: false,
    sourceType,
    // The engine validates native await syntax; generator yields are only
    // valid in the loader's execution wrapper, not in a SourceTextModule.
    transformTopLevelAwait: false
  })
  if (isModule) {
    // Construction parses a module, but does not link or evaluate it. In
    // particular, it cannot turn a resolution or runtime error into a parse
    // error by loading a dependency or running a module body.
    new vm.SourceTextModule(compiled.code, { identifier: filename })
  } else {
    new vm.Script(compiled.code, { filename })
  }
}

// Native vm.Script does not yet parse dynamic import.defer() on all supported
// Node versions. Run script-goal cases through esm-sync's existing compiler
// and dynamic-import runtime, without wrapping them as CommonJS or modules.
// Each Test262 case gets its own subprocess, so this temporary runtime binding
// cannot leak between cases or change another case's global environment.
const SCRIPT_RUNTIME_NAME = "__esmSyncTest262ScriptRuntime__"
const deferredCallPattern = /\bimport\s*\.\s*defer\s*\(/

function getScriptRuntime(filename) {
  const { Module } = require("node:module")
  const root = path.resolve(__dirname, "../..")
  const esm = require(root)
  const ownModule = require.cache[require.resolve(root)]
  if (!ownModule) throw new Error("Test262: esm-sync module is not loaded")

  // Reuse esm-sync's private, existing internal-protocol objects rather than
  // reimplementing deferred import or adding an application-facing API.
  const ownRequire = esm(ownModule)
  const version = require(path.join(root, "package.json")).version
  const shared = ownRequire(Symbol.for(`esm\u200d@${version}:shared`))
  const Entry = ownRequire(shared.symbol.entry)
  const Runtime = ownRequire(shared.symbol.runtime)
  if (typeof Entry?.get !== "function" || typeof Runtime?.enable !== "function") {
    throw new Error("Test262: esm-sync script runtime is unavailable")
  }

  const scriptModule = new Module(filename, module)
  scriptModule.filename = filename
  scriptModule.paths = Module._nodeModulePaths(path.dirname(filename))
  return Runtime.enable(Entry.get(scriptModule), Object.create(null))
}

function runScript(filename, trackNativeImports = false) {
  const source = readFileSync(filename, "utf8")
  let code = source

  if (deferredCallPattern.test(source)) {
    const compiled = getCompiler().compile(source, {
      hint: 1,
      pragmas: false,
      runtimeName: SCRIPT_RUNTIME_NAME,
      sourceType: 1
    })

    // A string or comment mentioning import.defer must not change the
    // execution path: only the compiler's actual deferred-import transform
    // opts into esm-sync's runtime.
    if (compiled.code.includes(`${SCRIPT_RUNTIME_NAME}.q(`)) {
      if (Object.hasOwn(globalThis, SCRIPT_RUNTIME_NAME)) {
        throw new Error("Test262: script runtime binding already exists")
      }
      Object.defineProperty(globalThis, SCRIPT_RUNTIME_NAME, {
        configurable: true,
        value: getScriptRuntime(filename)
      })
      code = compiled.code
    }
  }

  const options = {
    filename,
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER
  }
  // Always validate the original grammar before instrumenting a runtime test.
  // An import Promise observer must never turn invalid Test262 syntax into valid code.
  const original = new vm.Script(code, options)
  if (!trackNativeImports || code !== source) return original.runInThisContext()

  const { instrumentNativeImports } = require("./import-promise-tracking.cjs")
  const observerName = `__test262_native_import_${require("node:crypto").randomUUID().replaceAll("-", "_")}`
  let instrumented
  try {
    instrumented = instrumentNativeImports(source, observerName)
  } catch (failure) {
    // Acorn may not recognize a newer host grammar production. In that case,
    // keep the original VM execution instead of changing its parse result.
    if (!(failure instanceof SyntaxError)) throw failure
    return original.runInThisContext()
  }
  if (instrumented === null) return original.runInThisContext()

  const importPromises = new WeakSet()
  Object.defineProperty(globalThis, observerName, {
    configurable: true,
    value(promise) {
      importPromises.add(promise)
      return promise
    }
  })
  process.on("unhandledRejection", (reason, promise) => {
    if (!importPromises.has(promise)) throw reason
  })
  return new vm.Script(instrumented, options).runInThisContext()
}

// Use the loader's own parse/link path, not a second implementation based on
// vm.SourceTextModule. Compiler and bridge bootstrap errors must escape
// the Test262 reporter rather than look like expected resolution failures.
let moduleLoader

function getModuleLoader() {
  if (moduleLoader) return moduleLoader

  const root = path.resolve(__dirname, "../..")
  const esm = require(root)
  const ownModule = require.cache[require.resolve(root)]
  if (!ownModule) throw new Error("Test262: esm-sync module is not loaded")

  // The loader's internal require(symbol) protocol already exposes its
  // shared state to esm-sync's own modules. It is not a public application API.
  const ownRequire = esm(ownModule)
  const version = require(path.join(root, "package.json")).version
  const shared = ownRequire(Symbol.for(`esm\u200d@${version}:shared`))
  const load = shared?.module?.test262Load
  if (typeof load !== "function") {
    throw new Error("Test262: esm-sync test-only module loader is unavailable")
  }

  moduleLoader = (filename, linkOnly) => load(filename, module, linkOnly)
  return moduleLoader
}

function runModule(filename) {
  // Instantiate and evaluate via the same esm-sync loader used for the
  // resolution check. Requiring a syntax-free .js file can instead run Node's
  // CommonJS loader, which does not respect Test262's module flag.
  return getModuleLoader()(filename, false)
}

function checkModuleLink(filename) {
  const link = getModuleLoader()

  try {
    link(filename, true)
    return { linked: true }
  } catch (error) {
    // The root is parsed before instantiation. Syntax errors discovered while
    // loading dependencies belong to the resolution phase of the root test.
    return { linked: false, phase: "resolution", error }
  }
}

module.exports = { checkModuleLink, getCompiler, getModuleLoader, parseTest, runModule, runScript }
