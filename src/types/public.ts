/** Public options accepted by the CommonJS loader factory. */
export interface CommonJsOptions {
  cache: boolean
  esModule: boolean
  extensions: boolean
  mutableNamespace: boolean
  namedExports: boolean
  paths: boolean
  vars: boolean
  dedefault: boolean
  topLevelReturn: boolean
}

export interface Options {
  cache: boolean | string
  debug: boolean
  sourceMap: boolean
  cjs: boolean | Partial<CommonJsOptions>
  mainFields: string[]
  mode: "auto" | "all" | "strict"
  await: boolean
  force: boolean
  wasm: boolean
}

/** Callable CommonJS package entry; also used by source-only tooling checks. */
export type EsmFactory = (mod: typeof module, options?: Partial<Options>) => NodeJS.Require
