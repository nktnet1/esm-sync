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
  const compiled = getCompiler().compile(source, { hint: sourceType, pragmas: false, sourceType })
  if (isModule) {
    // Construction parses a module, but does not link or evaluate it. In
    // particular, it cannot turn a resolution or runtime error into a parse
    // error by loading a dependency or running a module body.
    new vm.SourceTextModule(compiled.code, { identifier: filename })
  } else {
    new vm.Script(compiled.code, { filename })
  }
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

module.exports = { checkModuleLink, getCompiler, getModuleLoader, parseTest, runModule }
