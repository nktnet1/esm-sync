import assert from "node:assert/strict"
import { cpSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { extractHostPackage } from "./host-archives.ts"
import { hostWebContainerSdk } from "./host-runtimes.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const source = extractHostPackage(hostWebContainerSdk)
const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8")) as {
  name: string
  version: string
}
assert.equal(manifest.name, "@webcontainer/api")
assert.equal(manifest.version, "1.6.4")
const target = path.join(root, ".cache/webcontainer-sdk")
mkdirSync(target, { recursive: true })
cpSync(source, realpathSync(target), { recursive: true })
console.log("SDK @webcontainer/api 1.6.4 (checksum verified)")
