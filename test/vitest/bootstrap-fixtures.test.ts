import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { cp, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import AdmZip from "adm-zip"
import acornPackage from "acorn/package.json"
import { it } from "vitest"

const root = fileURLToPath(new URL("../../", import.meta.url))
const run = promisify(execFile)

it("prepares Acorn from a checkout without vendor or generated files and still rejects missing owned imports", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-clean-fixtures-"))
  try {
    const excluded = path.join(root, "src/vendor")
    for (const name of ["src", "tooling", "bootstrap", "diagnostics", "harness"])
      await cp(path.join(root, name), path.join(directory, name), {
        recursive: true,
        filter: (source) => source !== excluded
      })
    for (const name of [
      "package.json",
      "index.d.ts",
      "tsconfig.source.json",
      "tsconfig.tooling.json",
      "tsconfig.bootstrap.json",
      "tsconfig.harness.json"
    ])
      await cp(path.join(root, name), path.join(directory, name))
    await symlink(
      await realpath(path.join(root, "node_modules")),
      path.join(directory, "node_modules"),
      "junction"
    )
    assert.ok(!(await readdir(directory)).includes("script"))
    assert.ok(!(await readdir(path.join(directory, "src"))).includes("vendor"))

    const archive = new AdmZip()
    const archiveRoot = `acorn-${acornPackage.version}/acorn/`
    archive.addFile(
      archiveRoot + "package.json",
      Buffer.from(JSON.stringify({ version: acornPackage.version }))
    )
    archive.addFile(archiveRoot + "src/state.js", Buffer.from("export class Parser {}\n"))
    await writeFile(path.join(directory, "acorn.zip"), archive.toBuffer())
    await writeFile(
      path.join(directory, "offline.cjs"),
      `const assert = require('node:assert/strict')
const fs = require('node:fs')
globalThis.fetch = async (url) => {
  assert.equal(url, ${JSON.stringify("https://github.com/ternjs/acorn/archive/" + acornPackage.version + ".zip")})
  return new Response(fs.readFileSync(require('node:path').join(__dirname, 'acorn.zip')))
}
`
    )
    const args = ["tooling/esm/cli.ts", "setup-fixtures", "acorn"]
    const options = {
      cwd: directory,
      timeout: 60_000,
      windowsHide: true,
      env: {
        ...process.env,
        NODE_OPTIONS: "--require " + JSON.stringify(path.join(directory, "offline.cjs"))
      }
    }
    const result = await run(process.execPath, args, options)
    assert.match(result.stdout, /\[acorn\] setup complete\./)
    assert.equal(result.stderr, "")
    assert.equal(
      await readFile(path.join(directory, "src/vendor/acorn/acorn/src/state.js"), "utf8"),
      "export class Parser {}\n"
    )
    assert.ok(
      !(await readdir(path.join(directory, "script"), { recursive: true })).some((name) =>
        /\.d\.[cm]?ts$/.test(name)
      )
    )

    await writeFile(
      path.join(directory, "tooling/missing-side-effect.ts"),
      'import "./missing-owned-module.js"\n'
    )
    await assert.rejects(run(process.execPath, args, options), (error: unknown) => {
      assert.ok(error instanceof Error && "stderr" in error && typeof error.stderr === "string")
      assert.match(error.stderr, /TS2882/)
      assert.match(error.stderr, /missing-owned-module\.js/)
      return true
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 120_000)
