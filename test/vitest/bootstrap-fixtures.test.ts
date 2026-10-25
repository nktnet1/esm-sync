import assert from "node:assert/strict"
import { cp, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import AdmZip from "adm-zip"
import acornPackage from "acorn/package.json"
import { it } from "vitest"
import { runNodeCommand } from "./helpers/run-command.ts"

const root = fileURLToPath(new URL("../../", import.meta.url))
const commandTimeout = 120_000

it(
  "prepares Acorn from a checkout without vendor or generated files and still rejects missing owned imports",
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "esm-sync-clean-fixtures-"))
    try {
      const excluded = path.join(root, "src/vendor")
      for (const name of ["src", "script/src", "config", "debug", "test/harness"])
        await cp(path.join(root, name), path.join(directory, name), {
          recursive: true,
          filter: (source) => source !== excluded
        })
      for (const name of ["package.json", "tsdown.config.mts"])
        await cp(path.join(root, name), path.join(directory, name))
      await symlink(
        await realpath(path.join(root, "node_modules")),
        path.join(directory, "node_modules"),
        "junction"
      )
      assert.deepEqual(await readdir(path.join(directory, "script")), ["src"])
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
      const args = ["script/src/esm/cli.ts", "setup-fixtures", "acorn"]
      const options = {
        cwd: directory,
        timeout: commandTimeout,
        env: {
          ...process.env,
          NODE_OPTIONS: "--require " + JSON.stringify(path.join(directory, "offline.cjs"))
        }
      }
      const result = await runNodeCommand(args, options)
      assert.match(result.stdout, /\[acorn\] setup complete\./, result.diagnostic)
      assert.equal(result.stderr, "", result.diagnostic)
      assert.equal(
        await readFile(path.join(directory, "src/vendor/acorn/acorn/src/state.js"), "utf8"),
        "export class Parser {}\n"
      )
      assert.ok(
        !(await readdir(path.join(directory, "script"), { recursive: true })).some(
          (name) => !name.startsWith("src" + path.sep) && /\.d\.[cm]?ts$/.test(name)
        )
      )

      assert.ok(
        (await readdir(path.join(directory, "dist/script"))).includes("build-sync-await-dev.js")
      )
      for (const name of ["dist/esm.js", "dist/index.js", "dist/script/build-sync-await.js"])
        await assert.rejects(readFile(path.join(directory, name)), { code: "ENOENT" })

      await writeFile(
        path.join(directory, "script/src/missing-side-effect.ts"),
        'import "./missing-owned-module.js"\n'
      )
      const failure = await runNodeCommand(args, {
        ...options,
        expectedExitCode: 1
      })
      assert.match(failure.stderr, /TS2882/, failure.diagnostic)
      assert.match(failure.stderr, /missing-owned-module\.js/, failure.diagnostic)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  2 * commandTimeout + 30_000
)
