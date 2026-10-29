import type { ModuleRegistry } from "./registry.js"
import type Entry from "../entry.js"
import type Package from "../package.js"
import type { Context } from "node:vm"
import type { Stats } from "node:fs"

export type UnknownRecord = Record<PropertyKey, unknown>
export interface RuntimeRequire {
  (id: string | symbol): unknown
  cache: Record<string, ModuleRecord>
  extensions: Record<string, (mod: ModuleRecord, filename: string) => void>
  main?: ModuleRecord | undefined
  resolve: {
    (id: string, options?: { paths?: string[] }): string
    paths?(id: string): string[] | null
  }
}
export interface ModuleRecord {
  constructor: ModuleConstructor
  id: string
  filename: string | null
  path: string
  parent: ModuleRecord | null | undefined
  children: ModuleRecord[]
  paths: string[] | undefined
  exports: unknown
  loaded: boolean
  require: (id: string | symbol) => unknown
  _compile: (content: string, filename: string) => unknown
  load(filename: string): unknown
}
export interface ModuleConstructor {
  new (id?: string, parent?: ModuleRecord | null): ModuleRecord
  prototype: ModuleRecord
  Module: ModuleConstructor
  _cache: Record<string, ModuleRecord>
  _extensions: RuntimeRequire["extensions"]
  _findPath(request: string, paths: string[], isMain?: boolean): string | false
  _initPaths(): void
  _load(request: string | symbol, parent?: ModuleRecord | null, isMain?: boolean): unknown
  _nodeModulePaths(from: string): string[]
  _preloadModules(requests: string[]): void
  _resolveFilename(
    request: string,
    parent?: ModuleRecord | null,
    isMain?: boolean,
    options?: { paths?: string[] }
  ): string
  _resolveLookupPaths(
    request: string,
    parent: ModuleRecord | null | undefined,
    newReturn: true
  ): string[] | null
  _resolveLookupPaths(
    request: string,
    parent?: ModuleRecord | null,
    newReturn?: false
  ): [string, string[] | null]
  builtinModules: readonly string[]
  globalPaths: string[]
  wrap(content: string): string
  wrapper: string[]
  createRequireFromPath(filename: string): RuntimeRequire
  createRequire?(filename: string): RuntimeRequire
  runMain?: ((main?: string) => void) | undefined
  _pathCache?: Record<string, string>
}
export interface Process
  extends Omit<NodeJS.Process, "mainModule" | "noDeprecation" | "throwDeprecation"> {
  _tickCallback?(): void
  binding(name: string): unknown
  mainModule?: ModuleRecord | undefined
  type?: string | undefined
  noDeprecation?: boolean | undefined
  throwDeprecation?: boolean | undefined
}
export interface LineInfo {
  column: number
  line: number
}
export interface CompileData {
  circular: number
  code: string | null
  codeWithTDZ: string | null
  filename: string | null
  firstAwaitOutsideFunction: LineInfo | null
  firstReturnOutsideFunction: LineInfo | null
  mtime: number
  scriptData: Buffer | null
  sourceType: number
  transforms: number
  yieldIndex: number
}
export interface CompiledSource extends CompileData {
  code: string
}
export type Namespace = Record<PropertyKey, unknown>
export type Getter = (() => unknown) & {
  id?: string
  owner?: Entry
  type?: number
  deferred?: boolean
}
export type ReadyGetter = Getter & { id: string; owner: Entry; type: number }
export type Setter = ((value: unknown, entry: Entry) => unknown) & {
  owner?: Entry
  type?: number
  exportedName?: string | null
  importedName?: string
  localNames?: string[]
  last?: unknown
  deferred?: boolean
  id?: string
}
export type ReadySetter = Setter & { localNames: string[]; owner: Entry; type: number }
export interface LoaderState {
  module: {
    breakFirstLine: boolean
    extensions: RuntimeRequire["extensions"]
    globalPaths: string[]
    mainModule: ModuleRecord | undefined
    moduleCache: Record<string, ModuleRecord>
    scratchCache: Record<string, ModuleRecord>
  }
  package: { cache: Map<string, Package | null>; default: Package | null }
}
export interface SharedState {
  bridged: Map<unknown, Entry>
  circularErrorMessage: string | undefined
  customInspectKey: string | symbol | undefined
  defaultInspectOptions: import("node:util").InspectOptions | undefined
  defaultGlobal: typeof globalThis
  originalConsole: Console | typeof Function.prototype
  proxyNativeSourceText: string
  runtimeName: string
  unsafeContext: Context
  entry: { cache: WeakMap<object, Entry> }
  external: typeof __external__
  inited: boolean
  loader: Map<unknown, LoaderState>
  memoize: {
    moduleCache: WeakMap<object, Record<string, ModuleRecord>>
    builtinEntries: Map<string, Entry>
    builtinModules: Map<string, ModuleRecord>
    fsRealpath: Map<string, string>
    moduleESMResolveFilename: Map<string, string>
    moduleInternalFindPath: Map<string, string>
    moduleInternalReadPackage: Map<string, Record<string, unknown> | null>
    modulePackageExportsErrors: WeakSet<object>
    moduleStaticResolveFilename: Map<string, string>
    shimFunctionPrototypeToString: WeakMap<object, boolean>
    shimProcessBindingUtilGetProxyDetails: Map<unknown, boolean>
    shimPuppeteerExecutionContextPrototypeEvaluateHandle: WeakMap<object, boolean>
    utilGetProxyDetails: WeakMap<
      object,
      { details: import("../own/proxy.js").ProxyDetails | undefined }
    >
    utilMaskFunction: WeakMap<
      object,
      { proxy: object; source: typeof Function.prototype; toString: typeof Function.prototype }
    >
    utilMaxSatisfying: Map<string, string | null>
    utilParseURL: Map<string, import("../util/parse-url.js").ParsedURL>
    utilProxyExports: WeakMap<
      object,
      {
        proxy: object
        wrap: WeakMap<object, typeof Function.prototype>
        unwrap: WeakMap<object, typeof Function.prototype>
      }
    >
    utilSatisfies: Map<string, boolean>
    utilUnwrapOwnProxy: WeakMap<object, object>
    utilUnwrapProxy: WeakMap<object, object>
  }
  module: ModuleRegistry & { safeInspector?: { console?: unknown } }
  moduleState: {
    configuring: boolean
    instantiating: boolean
    parsing: boolean
    requireDepth: number
    statFast: Map<string, number> | null
    statSync: Map<string, Stats | null> | null
    asyncEvaluation?: import("../module/internal/async-graph.js").Evaluation | null | undefined
    asyncImport?: boolean | undefined
    asyncEvaluationOrder?: number
  }
  package: { dir: Map<string, CacheData>; root: Map<string, string> }
  pendingScripts: Map<string, Map<string, CachedScript>>
  pendingWrites: Map<string, Map<string, CompileData>>
  realpathNativeSync: typeof import("node:fs").realpathSync.native | undefined
  reloaded: boolean
  safeGlobal: typeof globalThis
  support: {
    wasm: boolean
    await: boolean
    consoleOptions: boolean
    createCachedData: boolean
    inspectProxies: boolean
    lookupShadowed: boolean
    nativeProxyReceiver: boolean
    realpathNative: boolean
    replShowProxy: boolean
    vmCompileFunction: boolean
  }
  symbol: Record<
    | "_compile"
    | "entry"
    | "mjs"
    | "namespace"
    | "package"
    | "proxy"
    | "realGetProxyDetails"
    | "realRequire"
    | "runtime"
    | "shared"
    | "wrapper",
    symbol
  >
  unsafeGlobal: typeof globalThis
  utilBinding: { errorDecoratedSymbol: string | symbol | undefined; hiddenKeyType: string }
}

export interface CJSOptions {
  cache: boolean
  dedefault: boolean
  esModule: boolean
  extensions: boolean
  mutableNamespace: boolean
  namedExports: boolean
  paths: boolean
  topLevelReturn: boolean
  vars: boolean
}
export interface PackageOptions {
  await: boolean
  cache: boolean | string
  cjs: CJSOptions
  debug: boolean
  force: boolean
  mainFields: string[]
  mode: number
  sourceMap: boolean | undefined
  wasm: boolean
}
export type CacheMeta =
  | [number, number]
  | [
      number,
      number,
      number,
      number,
      number,
      [number, number] | null,
      [number, number] | null,
      string | null
    ]
  | [
      number,
      number,
      number,
      number,
      number,
      [number, number] | null,
      [number, number] | null,
      string | null,
      number,
      number
    ]
export interface CacheData {
  buffer: Buffer | undefined
  compile: Map<string, CompileData | null>
  meta: Map<string, CacheMeta>
  dirty?: boolean
}
export interface CachedScript {
  createCachedData?: () => Buffer
  cachedDataProduced?: boolean | undefined
  cachedData?: Buffer | undefined
  cachedDataRejected?: boolean | undefined
}
export interface ResolvedCompilerOptions {
  cjsPaths: boolean
  cjsVars: boolean
  generateVarDeclarations: boolean
  hint: number
  pragmas: boolean
  runtimeName: string
  sourceType: number
  strict: boolean | undefined
  topLevelReturn: boolean
  transformTopLevelAwait: boolean
}
export type CompilerOptions = {
  [K in keyof ResolvedCompilerOptions]?: ResolvedCompilerOptions[K] | undefined
}
export interface CacheCompileOptions extends CompilerOptions {
  async?: boolean | undefined
  sourceMap?: boolean | undefined
  eval?: boolean | undefined
  filename?: string | null | undefined
  mtime?: number | undefined
  cacheName?: string | undefined
  cachePath?: string | undefined
}
