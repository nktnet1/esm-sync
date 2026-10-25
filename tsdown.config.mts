import path from "node:path"
import { createRequire } from "node:module"
import ts from "typescript"
import { defineConfig, type ExportsOptions, type TsdownPlugin, type UserConfig } from "tsdown"
import babelOptions from "./config/babel.ts"
import packageInfo from "./package.json" with { type: "json" }

const require = createRequire(import.meta.url)
const babel = require("@babel/core") as {
  transformSync(code: string, options: object): { code?: string | null } | null
}
const isProd = /production/.test(process.env.ESM_ENV ?? "")
const isTest = /test/.test(process.env.ESM_ENV ?? "")
// Standalone entries share source work without sharing runtime chunks.
const transformedSources = new Map<string, { source: string; output: string }>()
// Retain the loader's per-function strict/sloppy modes and Node 6 transforms.
// TypeScript erasure stays inside the bundler; only tsdown writes build outputs.
function legacySources(): TsdownPlugin<unknown> {
  return {
    name: "esm-sync:legacy-sources",
    resolveId(specifier, importer) {
      const resolved = path.resolve(importer ? path.dirname(importer) : ".", specifier)
      if (/[/\\]acorn[/\\]src[/\\]regexp\.js$/.test(resolved))
        return path.resolve("src/acorn/replacement/regexp.ts")
    },
    transform(code, id) {
      if (id.includes("\0") || !/\.[jt]s$/.test(id)) return
      const cached = transformedSources.get(id)
      if (cached?.source === code) return { code: cached.output, map: null }
      const source = id.endsWith(".ts")
        ? ts.transpileModule(code, {
            fileName: id,
            compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
          }).outputText
        : code
      const result = babel.transformSync(source, {
        ...babelOptions,
        filename: id,
        babelrc: false,
        configFile: false,
        envName: process.env.BABEL_ENV || (isProd ? "production" : "development")
      })
      if (typeof result?.code !== "string") throw new Error(`Babel did not produce code for ${id}`)
      transformedSources.set(id, { source: code, output: result.code })
      return { code: result.code, map: null }
    }
  }
}

const base: UserConfig = {
  cwd: path.resolve("."),
  format: "cjs",
  platform: "node",
  target: "es2015",
  dts: false,
  clean: false,
  sourcemap: false,
  minify: isProd
    ? {
        compress: { target: "es2015" },
        mangle: { reserved: ["__shared__"] },
        codegen: { asciiOnly: true, legalComments: "inline" }
      }
    : false,
  cjsDefault: true,
  outExtensions: () => ({ js: ".js" }),
  outputOptions: { strict: true, codeSplitting: false }
}

// tsdown owns the canonical root export and legacy main/types fields. The
// bootstrap entries must remain separate builds (their strict modes differ),
// so only their compatibility aliases need to be added here. tsdown currently
// emits a string for a single-format entry rather than a typed export object.
const packageExports = {
  legacy: true,
  bin: false,
  inlinedDependencies: false,
  customExports(generated: Record<string, unknown>) {
    const root = generated["."]
    if (typeof root !== "string" || !root.startsWith("./dist/") || !root.endsWith("/esm.js")) {
      throw new Error("tsdown did not generate the expected CommonJS root entry")
    }

    const withTypes = (js: string) => ({ types: js.replace(/\.js$/, ".d.ts"), default: js })

    const esm = withTypes(root)
    const index = withTypes(root.replace(/\/esm\.js$/, "/index.js"))
    return {
      ...generated,
      ".": esm,
      "./esm": esm,
      "./esm.js": esm,
      "./index": index,
      "./index.js": index
    }
  }
} satisfies ExportsOptions
const externalGlobals = [
  "Array",
  "Buffer",
  "Error",
  "EvalError",
  "Function",
  "JSON",
  "Object",
  "Promise",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "SyntaxError",
  "TypeError",
  "URIError",
  "eval"
]
const banner = [
  "var __shared__;",
  "var __non_webpack_module__ = module;",
  "var __non_webpack_require__ = require;",
  "var __external__ = { " +
    externalGlobals.map((name) => `${name}: global.${name}`).join(", ") +
    " };",
  "var console = global.console;"
].join("\n")
const entries: Record<string, string> = { "esm/loader": "src/index.ts" }
if (isTest)
  Object.assign(entries, {
    "build/compiler": "src/compiler.ts",
    "build/entry": "src/entry.ts",
    "build/resolve-exports": "src/module/internal/resolve-exports.ts",
    "build/get-file-path-from-url": "src/util/get-file-path-from-url.ts",
    "build/get-url-from-file-path": "src/util/get-url-from-file-path.ts",
    "build/runtime": "src/runtime.ts"
  })

export default defineConfig([
  ...Object.entries(entries).map(
    ([name, entry]): UserConfig => ({
      ...base,
      name,
      entry: { [name]: entry },
      outDir: "dist",
      treeshake: false,
      deps: { onlyBundle: ["json-6", "semver"] },
      outputOptions: { ...base.outputOptions, intro: banner },
      define: {
        __ESM_PACKAGE_FILENAMES__: JSON.stringify(
          packageInfo.files.map((filename) => path.posix.relative("dist", filename))
        ),
        __ESM_PACKAGE_VERSION__: JSON.stringify(packageInfo.version),
        "process.env.ESM_SYNC_TEST_BUILD": JSON.stringify(
          process.env.ESM_SYNC_TEST_BUILD ?? isTest
        ),
        ...(isProd
          ? { "process.env.NODE_DEBUG": JSON.stringify(process.env.NODE_DEBUG ?? false) }
          : {})
      },
      plugins: [legacySources()]
    })
  ),
  // Separate single-entry builds preserve each native CommonJS module context
  // and keep public entry points independent of shared generated chunks.
  ...Object.entries({
    esm: "src/bootstrap/esm.ts",
    index: "src/bootstrap/index.ts",
    "script/build-sync-await": "script/src/build-sync-await.ts"
  }).map(
    ([name, entry]): UserConfig => ({
      ...base,
      name: `bootstrap:${name}`,
      // Only the public CommonJS entry points publish declarations.
      dts: name === "esm" || name === "index" ? { generator: "tsc" } : false,
      // One canonical entry owns package metadata; generating from the index
      // compatibility entry would change the legacy main from esm to index.
      exports: name === "esm" ? packageExports : false,
      entry: { [name]: entry },
      outDir: "dist",
      outputOptions: { ...base.outputOptions, strict: name !== "esm" },
      // Keep private loader types out of the public declaration graph.
      deps: { neverBundle: ["./esm.js"], dts: { neverBundle: ["../types/runtime.js"] } }
    })
  )
])
