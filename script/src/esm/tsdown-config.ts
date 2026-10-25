import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import ts from "typescript"
import { minify } from "terser"
import { defineConfig, type TsdownPlugin, type UserConfig } from "tsdown"
import babelOptions from "../babel-config.js"
import packageInfo from "../../../package.json" with { type: "json" }

const require = createRequire(import.meta.url)
const babel = require("@babel/core") as {
  transformSync(code: string, options: object): { code?: string | null } | null
}
const isProd = /production/.test(process.env.ESM_ENV ?? "")
const isTest = /test/.test(process.env.ESM_ENV ?? "")
// Standalone entries share source work without sharing runtime chunks.
const transformedSources = new Map<string, { source: string; output: string }>()
const terserOptions = JSON.parse(
  fs.readFileSync(".terserrc", "utf8")
) as import("terser").MinifyOptions

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

function productionMinifier(): TsdownPlugin<unknown> {
  return {
    name: "esm-sync:terser",
    async renderChunk(code, chunk) {
      const result = await minify(code, terserOptions)
      if (typeof result.code !== "string")
        throw new Error(`Terser did not produce code for ${chunk.fileName}`)
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
  cjsDefault: true,
  outExtensions: () => ({ js: ".js" }),
  outputOptions: { strict: true, codeSplitting: false }
}
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
const entries: Record<string, string> = { esm: "src/index.ts" }
if (isTest)
  Object.assign(entries, {
    compiler: "src/compiler.ts",
    entry: "src/entry.ts",
    "resolve-exports": "src/module/internal/resolve-exports.ts",
    "get-file-path-from-url": "src/util/get-file-path-from-url.ts",
    "get-url-from-file-path": "src/util/get-url-from-file-path.ts",
    runtime: "src/runtime.ts"
  })

export default defineConfig([
  ...Object.entries(entries).map(
    ([name, entry]): UserConfig => ({
      ...base,
      name,
      entry: { [name]: entry },
      outDir: "build",
      treeshake: false,
      deps: { onlyBundle: ["json-6", "semver"] },
      outputOptions: { ...base.outputOptions, intro: banner },
      define: {
        __ESM_PACKAGE_FILENAMES__: JSON.stringify(packageInfo.files),
        __ESM_PACKAGE_VERSION__: JSON.stringify(packageInfo.version),
        "process.env.ESM_SYNC_TEST_BUILD": JSON.stringify(
          process.env.ESM_SYNC_TEST_BUILD ?? isTest
        ),
        ...(isProd
          ? { "process.env.NODE_DEBUG": JSON.stringify(process.env.NODE_DEBUG ?? false) }
          : {})
      },
      plugins: [legacySources(), ...(isProd ? [productionMinifier()] : [])]
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
      entry: { [name]: entry },
      outDir: ".",
      outputOptions: { ...base.outputOptions, strict: name !== "esm" },
      deps: { neverBundle: ["./esm.js"] },
      plugins: isProd ? [productionMinifier()] : []
    })
  )
])
