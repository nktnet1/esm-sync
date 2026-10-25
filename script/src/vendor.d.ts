declare module "fs-extra" {
  const fs: Omit<typeof import("node:fs"), "writeFile" | "copyFile" | "mkdtemp" | "readFile"> & {
    writeFile: typeof import("node:fs/promises").writeFile
    copyFile: typeof import("node:fs/promises").copyFile
    mkdtemp: typeof import("node:fs/promises").mkdtemp
    readFile: typeof import("node:fs/promises").readFile
    ensureFileSync(filename: string, content?: string, encoding?: BufferEncoding): void
    emptyDir(directory: string): Promise<void>
    mkdirp(directory: string): Promise<void>
    copy(source: string, destination: string): Promise<void>
    copySync(source: string, destination: string): void
    ensureDir(directory: string): Promise<void>
    move(source: string, destination: string): Promise<void>
    pathExists(filename: string): Promise<boolean>
    remove(filename: string): Promise<void>
    removeSync(filename: string): void
    readJSONSync(filename: string): unknown
    outputFileSync(filename: string, content: string | Uint8Array): void
  }
  export = fs
}
declare module "adm-zip" {
  class AdmZip {
    constructor(buffer?: Buffer)
    addFile(filename: string, content: Buffer): void
    getEntries(): { entryName: string; isDirectory: boolean; getData(): Buffer }[]
    toBuffer(): Buffer
  }
  export = AdmZip
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
