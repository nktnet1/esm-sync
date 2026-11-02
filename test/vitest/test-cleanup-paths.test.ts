import path from "node:path"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import { describe, it, expect } from "vitest"
import { createRequire } from "node:module"
const createTestCleanupFilter = createRequire(import.meta.url)(
  "../../dist/script/test-cleanup-paths.js"
) as typeof import("../../script/src/test-cleanup-paths.js")

function filterFor(root: string, paths: typeof path) {
  const keptPaths = ["build", "esm", "node_modules", "src/vendor", "test/vendor"].map((part) =>
    paths.resolve(root, part)
  )

  return createTestCleanupFilter(
    {
      keptPaths,
      nodeModulesPath: paths.resolve(root, "node_modules"),
      sharedCachePath: paths.resolve(root, "node_modules/.cache")
    },
    paths
  )
}

describe("test fixture cleanup safety", () => {
  it("retains verify:all reports in dist while still clearing the checkout cache", () => {
    const project = "/repo/esm-sync"
    const shouldClean = createTestCleanupFilter(
      {
        keptPaths: [path.posix.join(project, "dist")],
        nodeModulesPath: path.posix.join(project, "node_modules"),
        sharedCachePath: path.posix.join(project, "node_modules/.cache")
      },
      path.posix
    )
    expect(shouldClean(path.posix.join(project, "dist/verification/run-example"))).toBe(false)
    expect(shouldClean(path.posix.join(project, ".cache"))).toBe(true)
  })

  it("preserves re-included native source patches while deleting ignored build artifacts", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-cleanup ü -")))
    try {
      const nativePatch = "script/patches/usb-1.6.0-defer-queue-init.patch"
      const files = [
        nativePatch,
        "reports/generated.patch",
        "nested/" + nativePatch,
        "keep.tmp",
        "nested/keep.tmp",
        "discard.tmp",
        "# reviewed source",
        ".cache/generated.txt"
      ]
      for (const name of files) {
        const target = path.join(directory, name)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, "preserve original bytes")
      }
      await writeFile(
        path.join(directory, ".gitignore"),
        [
          "# reviewed source",
          "",
          "*.patch",
          "!/" + nativePatch,
          "*.tmp",
          "!keep.tmp",
          ".cache"
        ].join("\r\n")
      )
      const matcher = path.join(directory, "dist/script/ignore-paths.cjs")
      await mkdir(path.dirname(matcher), { recursive: true })
      await writeFile(matcher, await readFile("dist/script/ignore-paths.js"))
      const cleanupFilter = path.resolve("dist/script/test-cleanup-paths.js")
      const source = `
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const candidates=require(process.argv[1]);
const filter=require(process.argv[2])({keptPaths:[],nodeModulesPath:path.resolve('node_modules'),sharedCachePath:path.resolve('node_modules/.cache')});
for(const target of candidates.filter(filter)){
 assert.ok(target.startsWith(process.cwd()+path.sep));
 fs.rmSync(target,{recursive:true,force:true});
}
for(const name of [${JSON.stringify(nativePatch)},'keep.tmp','nested/keep.tmp','# reviewed source'])
 assert.equal(fs.readFileSync(name,'utf8'),'preserve original bytes');
for(const name of ['reports/generated.patch',${JSON.stringify("nested/" + nativePatch)},'discard.tmp','.cache'])
 assert.equal(fs.existsSync(name),false,name+' was not cleaned');
console.log('cleanup-source:pass');
`
      const result = spawnSync(process.execPath, ["-e", source, matcher, cleanupFilter], {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, NODE_PATH: path.resolve("node_modules"), NODE_OPTIONS: "" }
      })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe("cleanup-source:pass")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  const platforms: Array<[string, string, typeof path]> = [
    ["POSIX", "/repo/esm-sync", path.posix],
    ["Windows", "D:\\a\\esm-sync\\esm-sync", path.win32]
  ]
  for (const [platform, root, paths] of platforms) {
    it(`preserves built assets, vendor fixtures and dependencies on ${platform}`, () => {
      const shouldClean = filterFor(root, paths)

      for (const relative of [
        "build",
        "build/compiler.js",
        "esm",
        "node_modules",
        "node_modules/.pnpm/pkg",
        "src/vendor",
        "test/vendor"
      ]) {
        expect(shouldClean(paths.join(root, relative)), relative).toBe(false)
      }

      expect(shouldClean(paths.join(root, "node_modules/.cache"))).toBe(true)
      expect(shouldClean(paths.join(root, "test/fixture/old.cache"))).toBe(true)
      expect(shouldClean(paths.join(root, "test/env/native-cache"))).toBe(true)
      expect(shouldClean(paths.join(root, "build-extra"))).toBe(true)
    })
  }

  it("handles mixed separators and drive-letter case in Windows glob results", () => {
    const shouldClean = filterFor("D:\\a\\esm-sync\\esm-sync", path.win32)

    expect(shouldClean("d:/A/esm-sync/esm-sync/node_modules")).toBe(false)
    expect(shouldClean("d:/A/esm-sync/esm-sync/src/vendor/acorn")).toBe(false)
    expect(shouldClean("d:/A/esm-sync/esm-sync/node_modules/.cache")).toBe(true)
  })
})
