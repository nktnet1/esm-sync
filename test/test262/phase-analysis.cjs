const { readFileSync } = require("node:fs")
const path = require("node:path")
const { fileURLToPath, pathToFileURL } = require("node:url")
const vm = process.getBuiltinModule("node:vm")

// The compiler bundle normally receives this binding from esm-sync's loader.
// The standalone Test262 phase checker needs the same compiler configuration.
let compiler

class UnsupportedLinkCheckError extends Error {}

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

  if (isModule) {
    getCompiler().compile(source, { hint: 2, pragmas: false, sourceType: 2 })
  } else {
    new vm.Script(source, { filename })
  }
}

// Node's vm.Module parser does not yet accept `import defer`, although the
// esm-sync compiler does. This link-only check replaces the phase modifier;
// it is never used to execute or validate the original import semantics.
function linkOnlySource(source) {
  return source.replace(/\bimport\s+defer\s+\*\s+as\s+/g, "import * as ")
}

async function checkModuleLink(filename) {
  const context = vm.createContext({})
  const cache = new Map()

  function createModule(file) {
    const resolved = path.resolve(file)
    const existing = cache.get(resolved)
    if (existing) return existing

    const extension = path.extname(resolved)
    let mod

    if (extension === ".json") {
      // Parsing JSON belongs to module loading/linking, not evaluation.
      JSON.parse(readFileSync(resolved, "utf8"))
      mod = new vm.SyntheticModule(["default"], () => {}, { context, identifier: resolved })
    } else if (extension === ".js" || extension === ".mjs") {
      mod = new vm.SourceTextModule(linkOnlySource(readFileSync(resolved, "utf8")), {
        context,
        identifier: resolved
      })
    } else {
      throw new UnsupportedLinkCheckError(`Unsupported Test262 module extension: ${extension}`)
    }

    cache.set(resolved, mod)
    return mod
  }

  let root
  try {
    root = createModule(filename)
  } catch (error) {
    // The root must be parseable before we can infer anything about linking.
    return { phase: "unknown", error }
  }

  try {
    await root.link(async (specifier, referencingModule, importAttributes) => {
      if (!specifier.startsWith(".")) {
        throw new UnsupportedLinkCheckError(`Unsupported Test262 phase-check specifier: ${specifier}`)
      }

      const resolved = fileURLToPath(new URL(specifier, pathToFileURL(referencingModule.identifier)))
      const type = importAttributes?.attributes?.type
      const attributes = importAttributes?.attributes ?? {}
      const extension = path.extname(resolved)

      if (
        Object.keys(attributes).some((key) => key !== "type") ||
        (type !== undefined && type !== (extension === ".json" ? "json" : undefined))
      ) {
        throw new SyntaxError(`Unsupported import attributes for ${specifier}`)
      }

      return createModule(resolved)
    })
    return { phase: "runtime" }
  } catch (error) {
    return { phase: error instanceof UnsupportedLinkCheckError ? "unknown" : "resolution", error }
  }
}

module.exports = { checkModuleLink, parseTest }
