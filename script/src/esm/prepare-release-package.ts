import {
  copyFileSync,
  globSync,
  lstatSync,
  mkdirSync,
  statSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { styleText } from "node:util"
import { createPublishManifest } from "../package-manifest.ts"
import { validateReleaseManifest } from "./release-policy.ts"

export interface PrepareReleaseOptions {
  root: string
  tag: string
  expectedSha?: string
}

export function prepareReleasePackage({ root, tag, expectedSha }: PrepareReleaseOptions): void {
  const canonicalRoot = realpathSync(root)
  const manifest: Record<string, unknown> = JSON.parse(
    readFileSync(join(canonicalRoot, "package.json"), "utf8")
  )
  const version = validateReleaseManifest(manifest, tag)
  if (
    !Array.isArray(manifest.files) ||
    !manifest.files.every((entry: unknown) => typeof entry === "string")
  )
    throw new Error("package.json must contain a files array")
  if (
    typeof manifest.scripts !== "object" ||
    manifest.scripts === null ||
    typeof Reflect.get(manifest.scripts, "install") !== "string"
  )
    throw new Error("The release must retain esm-sync's native installation hook")

  if (expectedSha && !/^[a-f0-9]{40}$/.test(expectedSha))
    throw new Error("Invalid expected Git commit SHA")
  const directory = join(canonicalRoot, ".release/package")
  rmSync(join(canonicalRoot, ".release"), { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })

  const inputs = new Set(["LICENSE", "README.md"])
  for (const pattern of manifest.files as string[]) {
    if (isAbsolute(pattern) || pattern.startsWith("../") || pattern.includes("\\"))
      throw new Error(`Unsafe package file pattern: ${pattern}`)
    const matches = globSync(pattern, { cwd: canonicalRoot })
    if (matches.length === 0) throw new Error(`Missing release output matching ${pattern}`)
    for (const name of matches) inputs.add(name)
  }
  const requiredFiles = [
    "esm.js",
    "esm.d.ts",
    "index.js",
    "index.d.ts",
    "dist/esm.js",
    "dist/index.js",
    "dist/esm.d.ts",
    "dist/index.d.ts",
    "dist/esm/loader.js",
    "dist/script/build-sync-await.js",
    "native/sync-await.cc",
    `dist/native/${process.platform}-${process.arch}-${process.versions.modules}.node`
  ]
  for (const file of requiredFiles) {
    if (!inputs.has(file)) throw new Error(`Missing required release file: ${file}`)
  }

  for (const name of inputs) {
    const source = resolve(canonicalRoot, name)
    const location = relative(canonicalRoot, source)
    if (location.startsWith(`..${sep}`) || location === ".." || isAbsolute(location))
      throw new Error(`Package file escapes repository: ${name}`)
    const canonicalSource = realpathSync(source)
    const sourceLocation = relative(canonicalRoot, canonicalSource)
    if (
      sourceLocation.startsWith(`..${sep}`) ||
      sourceLocation === ".." ||
      isAbsolute(sourceLocation) ||
      !lstatSync(source).isFile()
    )
      throw new Error(`Release input must be a regular file in the repository: ${name}`)
    if (requiredFiles.includes(name) && statSync(source).size === 0)
      throw new Error(`Empty release output: ${name}`)
    const output = join(directory, location)
    mkdirSync(dirname(output), { recursive: true })
    copyFileSync(source, output)
  }
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify(createPublishManifest(manifest), null, 2)}\n`
  )
  console.log(`Prepared ${styleText("green", `esm-sync@${version}`)} in .release/package`)
}

// The build/packaging workflow calls this directly with trusted GitHub event values.
if (import.meta.main) {
  const tag = process.env.GITHUB_REF_NAME
  const sha = process.env.GITHUB_SHA
  if (!tag || !sha) throw new Error("GITHUB_REF_NAME and GITHUB_SHA are required")
  prepareReleasePackage({ root: resolve(import.meta.dirname, "../../.."), tag, expectedSha: sha })
}
