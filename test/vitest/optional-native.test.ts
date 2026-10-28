import { realpathSync } from "node:fs"
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)))

async function withPackage(prebuilt: boolean, run: (directory: string) => Promise<void>) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-no-build-")))
  try {
    const files = [
      "package.json",
      "esm.js",
      "esm.d.ts",
      "index.js",
      "index.d.ts",
      "dist/esm.js",
      "dist/index.js",
      "dist/esm/loader.js",
      "dist/script/build-sync-await.js",
      "native/sync-await.cc"
    ]
    if (prebuilt)
      files.push(`dist/native/${process.platform}-${process.arch}-${process.versions.modules}.node`)
    for (const file of files) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
      await copyFile(path.join(root, file), path.join(directory, file))
    }
    await mkdir(path.join(directory, "node_modules"))
    await symlink(
      await realpath(path.join(root, "node_modules/punycode")),
      path.join(directory, "node_modules/punycode"),
      process.platform === "win32" ? "junction" : "dir"
    )
    await writeFile(path.join(directory, "ordinary.mjs"), "export const value = 42\n")
    await writeFile(
      path.join(directory, "microtask.mjs"),
      "export const value = await Promise.resolve(42)\n"
    )
    await writeFile(
      path.join(directory, "timer.mjs"),
      "export const value = await new Promise(resolve => setTimeout(() => resolve(42), 1))\n"
    )
    await writeFile(
      path.join(directory, "io.mjs"),
      "import { readFile } from 'node:fs/promises'; export const value = await readFile(new URL('./ordinary.mjs', import.meta.url), 'utf8')\n"
    )
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

for (const esmEnv of testEnvironments) {
  describe(`optional native installation (${esmEnv})`, () => {
    for (const scenario of ["skipped", "prebuilt", "failed"] as const) {
      it(`keeps packaged loading usable when installation is ${scenario}`, async () => {
        await withPackage(scenario === "prebuilt", async (directory) => {
          const manifest: { scripts: { install: string } } = JSON.parse(
            await readFile(path.join(directory, "package.json"), "utf8")
          )
          expect(manifest.scripts.install).toMatch(/^node -e /)
          const installSource: string = JSON.parse(
            manifest.scripts.install.slice("node -e ".length)
          )
          const source = `
const assert = require('node:assert/strict')
const path = require('node:path')
const directory = process.argv[1]
process.chdir(directory)
const fs = require('node:fs')
fs.mkdirSync(path.join(directory, 'headers'))
fs.writeFileSync(path.join(directory, 'headers/node_version.h'), '#define NODE_MODULE_VERSION ' + process.versions.modules)
process.env.ESM_SYNC_NODE_HEADERS = path.join(directory, 'headers')
const packageRequire = require('node:module').createRequire(path.join(directory, 'package.json'))
let compilerCalls = 0
require('node:child_process').spawnSync = () => {
  compilerCalls++
  return { status: 1, stdout: '', stderr: 'Compiler deliberately unavailable' }
}
const factory = packageRequire('esm-sync')
for (const alias of ['esm', 'esm.js', 'index', 'index.js']) {
  assert.equal(packageRequire('esm-sync/' + alias), factory)
}
const cache = ${JSON.stringify(esmEnv.endsWith("-cached"))} ? path.join(directory, 'cache') : false
const load = factory(module, { cache })
assert.equal(load(path.join(directory, 'ordinary.mjs')).value, 42)
assert.equal(load(path.join(directory, 'microtask.mjs')).value, 42)
assert.equal(compilerCalls, 0)
if (${JSON.stringify(scenario)} === 'prebuilt') {
  assert.equal(load(path.join(directory, 'timer.mjs')).value, 42)
  assert.match(load(path.join(directory, 'io.mjs')).value, /value = 42/)
}
if (${JSON.stringify(scenario)} !== 'skipped') {
  require('node:vm').runInNewContext(${JSON.stringify(installSource)}, { require: packageRequire })
  assert.equal(compilerCalls, ${scenario === "failed" ? 1 : 0})
}
if (${JSON.stringify(scenario)} !== 'prebuilt') {
  assert.throws(() => load(path.join(directory, 'timer.mjs')), { code: 'ERR_ESM_SYNC_ASYNC_PENDING' })
  assert.equal(load(path.join(directory, 'ordinary.mjs')).value, 42)
}
console.log('optional-native:pass')
`
          const result = await runNode(["-e", source, directory], esmEnv)
          expect(result.exitCode, result.stderr || result.stdout).toBe(0)
          expect(result.stdout).toMatch(/optional-native:pass/)
        })
      })
    }
  })
}
