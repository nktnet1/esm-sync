import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

export function exportWebContainerKit(reports: string): { directory: string; archive: string } {
  const target = path.join(reports, "webcontainer-check")
  mkdirSync(target, { recursive: true })
  const directory = realpathSync(target)
  const files = [
    "esm.js",
    "index.js",
    "dist/esm.js",
    "dist/index.js",
    "dist/esm/loader.js",
    ...[
      "package.json",
      "host-output.ts",
      "host-probes.ts",
      "host-runtimes.ts",
      "verify-host-usb.ts",
      "verify-hosts-container.ts",
      "verify-webcontainer.ts",
      "webcontainer-probe.ts",
      "webcontainer-kit.ts"
    ].map((name) => "script/src/esm/" + name)
  ]
  for (const name of ["LICENSE", "LICENSE.md"])
    if (existsSync(path.join(root, name))) files.push(name)
  for (const file of files) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true })
    cpSync(path.join(root, file), path.join(directory, file))
  }
  cpSync(
    path.join(root, "test/fixture/hosts/issue-917"),
    path.join(directory, "test/fixture/hosts/issue-917"),
    { recursive: true }
  )
  cpSync(
    realpathSync(path.join(root, "node_modules/punycode")),
    path.join(directory, "vendor/punycode"),
    { recursive: true }
  )
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as Record<
    string,
    unknown
  >
  delete manifest.devDependencies
  delete manifest.dependencies
  delete manifest.packageManager
  manifest.hostVerificationKit = true
  manifest.engines = { node: ">=22.18.0" }
  manifest.private = true
  manifest.scripts = {
    start: "node script/src/esm/verify-webcontainer.ts",
    "verify:webcontainer": "node script/src/esm/verify-webcontainer.ts"
  }
  writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest, null, 2))
  writeFileSync(
    path.join(directory, "VERIFY.txt"),
    "Run inside a WebContainer with Node 22.18 or newer. No npm install or build is needed.\n\nModule graph: node script/src/esm/verify-webcontainer.ts\nApplication build: node script/src/esm/verify-webcontainer.ts /path/to/ember-app\n\nThe application must have installed dependencies and a build script. Its source and lockfiles are unchanged.\nReports: .cache/host-verification/webcontainer-*/report.json\nA build that never invokes esm is not a successful application verification.\n"
  )
  const require = createRequire(import.meta.url)
  const Zip = require("adm-zip") as new () => {
    addLocalFolder(directory: string): void
    writeZip(file: string): void
  }
  const zip = new Zip()
  zip.addLocalFolder(directory)
  const archive = path.join(reports, "webcontainer-check.zip")
  zip.writeZip(archive)
  return { directory, archive }
}
