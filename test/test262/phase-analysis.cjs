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

  // The loader's script compiler can skip parsing text without import/export
  // candidates. Validate its output with vm.Script to catch those errors, but
  // only *after* transforming phase modifiers: older Node versions cannot
  // parse valid `import.source()` even when esm-sync can.
  const sourceType = isModule ? 2 : 1
  const compiled = getCompiler().compile(source, { hint: sourceType, pragmas: false, sourceType })
  if (!isModule) new vm.Script(compiled.code, { filename })
}

// Use the loader's own parse/link path, not a second implementation based on
// vm.SourceTextModule. Compiler and bridge bootstrap errors must escape
// the Test262 reporter rather than look like expected resolution failures.
let linkOnly
let moduleRequire

function getLinkOnly() {
  if (linkOnly) return linkOnly

  const root = path.resolve(__dirname, "../..")
  const esm = require(root)
  const ownModule = require.cache[require.resolve(root)]
  if (!ownModule) throw new Error("Test262: esm-sync module is not loaded")

  // The loader's internal require(symbol) protocol already exposes its
  // shared state to esm-sync's own modules. It is not a public application API.
  const ownRequire = esm(ownModule)
  const version = require(path.join(root, "package.json")).version
  const shared = ownRequire(Symbol.for(`esm\u200d@${version}:shared`))
  const check = shared?.module?.test262LinkOnly
  if (typeof check !== "function") {
    throw new Error("Test262: esm-sync test-only linker is unavailable")
  }

  linkOnly = (filename) => check(filename, module)
  moduleRequire = ownRequire
  return linkOnly
}

function runModule(filename) {
  getLinkOnly()
  return moduleRequire(filename)
}

function checkModuleLink(filename) {
  const link = getLinkOnly()

  try {
    link(filename)
    return { linked: true }
  } catch (error) {
    // The root is parsed before instantiation. Syntax errors discovered while
    // loading dependencies belong to the resolution phase of the root test.
    return { linked: false, phase: "resolution", error }
  }
}

module.exports = { checkModuleLink, getCompiler, getLinkOnly, parseTest, runModule }
