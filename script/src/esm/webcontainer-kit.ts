import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

export function exportWebContainerKit(reports: string): { directory: string; archive: string } {
  const target = path.join(reports, "webcontainer-check")
  mkdirSync(target, { recursive: true })
  const directory = realpathSync(target)
  const require = createRequire(import.meta.url)
  const ts = require("typescript") as typeof import("typescript")
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
    const output = path.join(directory, file.replace(/\.ts$/, ".js"))
    mkdirSync(path.dirname(output), { recursive: true })
    if (file.endsWith(".ts")) {
      const result = ts.transpileModule(readFileSync(path.join(root, file), "utf8"), {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          rewriteRelativeImportExtensions: true
        }
      })
      assert.equal(result.diagnostics?.length ?? 0, 0, "WebContainer worker transpilation failed")
      writeFileSync(output, result.outputText)
    } else cpSync(path.join(root, file), output)
  }
  cpSync(
    path.join(root, "test/fixture/hosts/issue-917"),
    path.join(directory, "test/fixture/hosts/issue-917"),
    { recursive: true }
  )
  cpSync(
    path.join(root, "test/fixture/hosts/issue-917/application"),
    path.join(directory, "application"),
    { recursive: true }
  )
  for (const file of ["value.js", "value.cjs"])
    cpSync(path.join(root, "test/fixture/hosts/issue-917", file), path.join(directory, file))
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
    start: "node script/src/esm/verify-webcontainer.js application"
  }
  writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest, null, 2))
  writeFileSync(
    path.join(directory, "VERIFY.txt"),
    "This worker is mounted and run automatically by pnpm verify:hosts:docker.\nNo manual upload, npm install, build, or native TypeScript support is needed inside the WebContainer.\nThe SDK receives the built loader, reconstructed consumer and generated reports.\nReports are exported to the host run's webcontainer directory.\nThe consumer is a reconstruction, not the complete historical Ember graph.\n"
  )
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
