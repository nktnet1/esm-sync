declare module "fs-extra" {
  const fs: Omit<typeof import("node:fs"), "writeFile" | "copyFile"> & {
    writeFile: typeof import("node:fs/promises").writeFile
    copyFile: typeof import("node:fs/promises").copyFile
    copy(source: string, destination: string): Promise<void>
    copySync(source: string, destination: string): void
    ensureDir(directory: string): Promise<void>
    move(source: string, destination: string): Promise<void>
    pathExists(filename: string): Promise<boolean>
    remove(filename: string): Promise<void>
    readJSONSync(filename: string): unknown
    outputFileSync(filename: string, content: string | Uint8Array): void
  }
  export = fs
}
declare module "adm-zip" {
  class AdmZip {
    constructor(buffer: Buffer)
    getEntries(): { entryName: string; isDirectory: boolean; getData(): Buffer }[]
  }
  export = AdmZip
}
declare module "golden-fleece" {
  export function patch(source: string, value: unknown): string
}
declare module "test262-parser" {
  interface Attributes {
    description?: string
    flags: Record<string, boolean>
    features?: string[]
    includes?: string[]
    negative?: { type: string; phase: string }
    [key: string]: unknown
  }
  export function parseFile(source: string): { attrs: Attributes; contents: string }
}
declare module "webpack" {
  export type Compiler = import("@rspack/core").Compiler
  export type Compilation = import("@rspack/core").Compilation
  export type Asset = import("@rspack/core").Asset
  export type AssetInfo = import("@rspack/core").AssetInfo
  export type TemplatePath = Parameters<import("@rspack/core").Compilation["getPath"]>[0]
  export type Configuration = import("@rspack/core").Configuration
  export namespace sources {
    type Source = import("@rspack/core").sources.Source
  }
}
declare module "webpack-bundle-analyzer" {
  export class BundleAnalyzerPlugin {
    constructor(options: {
      analyzerMode: string
      defaultSizes: string
      logLevel: string
      openAnalyzer: boolean
      reportFilename: string
    })
    apply(compiler: import("@rspack/core").Compiler): void
  }
}
declare module "unused-webpack-plugin" {
  class UnusedPlugin {
    constructor(options: { directories: string[]; exclude: string[]; root: string })
    apply(compiler: import("@rspack/core").Compiler): void
  }
  export = UnusedPlugin
}
