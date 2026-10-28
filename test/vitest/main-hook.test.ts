import { access, mkdir, rm, symlink } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, it, expect } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loaderOptions = { ESM_OPTIONS: "{cjs:false,mode:'auto'}" }
const testURL = pathToFileURL(testPath)

// @std/esm@0.26.0 calls the old one-argument internalModuleStat binding.
// Node 22.10-22.17 and Node 23 require two arguments and abort the process
// rather than throwing. This is an external host ABI limitation, not an esm-sync
// failure. Continue exercising it on unaffected Node releases, including 24/26.
const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split(".").map(Number)
const stdEsmHasUnsafeStatABI =
  (nodeMajor === 22 && nodeMinor >= 10 && nodeMinor < 18) || nodeMajor === 23

for (const esmEnv of testEnvironments) {
  function node(args: string[], options = loaderOptions) {
    return runNode(args, esmEnv, options, { cacheNamespace: "main-hook" })
  }

  function runMain(filename: string, options = loaderOptions) {
    return node(["-r", "../index.js", filename], options)
  }

  describe(`main hook (${esmEnv})`, () => {
    for (const requireFlag of ["-r", "--require"]) {
      for (const otherFlag of ["", "--no-deprecation", "--experimental-modules"]) {
        it(`supports ${requireFlag} ${otherFlag || "(no extra flag)"}`, async () => {
          const args = [
            ...(otherFlag ? [otherFlag] : []),
            requireFlag,
            "../index.js",
            "./fixture/main-hook/index.mjs"
          ]
          const { exitCode, stdout, stderr } = await node(args)

          expect(exitCode, stderr.slice(-4_000)).toBe(0)
          expect(stdout, stdout).toContain("main-hook:true")
        })
      }
    }

    for (const ESM_OPTIONS of [
      "{cjs:0,mode:'all'}",
      "{cjs:0,mode:all}",
      "{cjs:false,mode:'all'}",
      "{cjs:false,mode:all}"
    ]) {
      it(`supports ESM_OPTIONS=${ESM_OPTIONS}`, async () => {
        const { exitCode, stdout, stderr } = await runMain(
          "./fixture/main-hook/options/env/index.js",
          { ESM_OPTIONS }
        )
        expect(exitCode, stderr.slice(-4_000)).toBe(0)
        expect(stdout, stdout).toContain("esm-options:true")
      })
    }

    it("supports a custom disk cache", async () => {
      const cachePath = path.join(testPath, "fixture/main-hook/options/env-cache/.cache")
      try {
        await rm(cachePath, { force: true, recursive: true })
        const { exitCode, stderr } = await runMain(
          "./fixture/main-hook/options/env-cache/index.js",
          { ESM_OPTIONS: `{cache:${JSON.stringify(cachePath)}}` }
        )
        expect(exitCode, stderr.slice(-4_000)).toBe(0)
        await access(cachePath)
      } finally {
        await rm(cachePath, { force: true, recursive: true })
      }
    })

    const mainCases = [
      {
        name: "resolves a custom mainFields entry",
        filename: "./fixture/main-hook/options/env-main-fields/index.js",
        expected: "esm-options-main-fields:true",
        options: { ESM_OPTIONS: "{mainFields:['module']}" }
      },
      {
        name: "supports dynamic import in CommonJS",
        filename: "./fixture/main-hook/dynamic-import.js",
        expected: "dynamic-import-cjs:true"
      },
      {
        name: "exposes require.main in CommonJS",
        filename: "./fixture/main-hook/require-main.js",
        expected: "require-main:true"
      },
      {
        name: "hides process.mainModule in ESM",
        filename: "./fixture/main-hook/main-module/off/index.mjs",
        expected: "main-module:false"
      },
      {
        name: "exposes process.mainModule with cjs.cache",
        filename: "./fixture/main-hook/main-module/on/index.mjs",
        expected: "main-module:true"
      },
      {
        name: "loads @std/esm",
        filename: "./fixture/main-hook/std-esm.js",
        expected: `std-esm:${JSON.stringify({ a: "a", b: "b", c: "c", default: "default" })}`
      }
    ]

    for (const { name, filename, expected, options } of mainCases) {
      it.skipIf(name === "loads @std/esm" && stdEsmHasUnsafeStatABI)(name, async () => {
        const { exitCode, stdout, stderr } = await runMain(filename, options)
        expect(exitCode, stderr.slice(-4_000)).toBe(0)
        expect(stdout, stdout).toContain(expected)
      })
    }

    it("preserves import.meta.url", async () => {
      const filename = "fixture/main-hook/import-meta.mjs"
      const { exitCode, stdout, stderr } = await runMain(filename)
      expect(exitCode, stderr.slice(-4_000)).toBe(0)
      expect(stdout).toContain(
        `import-meta:${JSON.stringify({ url: new URL(filename, testURL).href })}`
      )
    })

    it("preserves query and fragment components in import.meta.url", async () => {
      const filename = "fixture/main-hook/query-fragment.js?a#a"
      const { exitCode, stdout, stderr } = await runMain(filename)
      expect(exitCode, stderr.slice(-4_000)).toBe(0)
      expect(stdout, stdout).toContain(`query-fragment:${new URL(filename, testURL).href}`)
    })

    it("treats extensionless files as CommonJS", async () => {
      const cjs = await runMain("./fixture/ext/no-ext-cjs")
      expect(cjs.exitCode, cjs.stderr.slice(-4_000)).toBe(0)
      expect(cjs.stderr).toBe("")

      const esm = await runMain("./fixture/ext/no-ext-esm")
      expect(esm.exitCode, "Extensionless ES module unexpectedly executed").not.toBe(0)
      expect(esm.stderr.length, "Expected a module-loading error").toBeGreaterThan(0)
    })

    for (const filename of ["missing", "missing.js", "missing.mjs"]) {
      for (const flag of ["", "--preserve-symlinks"]) {
        it(`rejects missing ${filename} ${flag || "without extra flags"}`, async () => {
          const { exitCode, stderr } = await node([
            ...(flag ? [flag] : []),
            "-r",
            "./fixture/main-hook/error-reporter.cjs",
            "-r",
            "../index.js",
            filename
          ])
          expect(exitCode, `Missing ${filename} unexpectedly loaded: ${stderr.slice(-4_000)}`).toBe(
            1
          )
          const marker = stderr.split("\n").find((line) => line.startsWith("main-hook-error:"))
          expect.assert(marker, stderr.slice(-4_000))
          const error = JSON.parse(marker.slice("main-hook-error:".length)) as {
            code: string
            message: string
          }
          expect(error.code).toBe("MODULE_NOT_FOUND")
          expect(error.message).toMatch(/^Cannot find module/)
          expect(error.message, error.message).toContain(filename)
        })
      }
    }

    it("does not swallow asynchronous errors", async () => {
      const { exitCode, stderr } = await runMain("./fixture/main-hook/async-error.mjs")
      expect(exitCode, "Expected the async error to fail the process").not.toBe(0)
      expect(stderr.length, "Expected a visible async error").toBeGreaterThan(0)
      expect(stderr.includes("async hook stack has become corrupted")).toBe(false)
    })

    for (const extension of [".js", ".mjs"]) {
      for (const flag of ["", "--preserve-symlinks"]) {
        it(`resolves ${extension} file symlinks ${flag || "without extra flags"}`, async () => {
          const dir = path.join(testPath, "fixture/main-hook/symlink/file")
          const linkPath = path.join(dir, `symlink${extension}`)
          try {
            await rm(linkPath, { force: true })
            await symlink(`real${extension}`, linkPath, "file")
            const { exitCode, stdout, stderr } = await node([
              ...(flag ? [flag] : []),
              "-r",
              "../index.js",
              linkPath
            ])
            expect(exitCode, stderr.slice(-4_000)).toBe(0)
            expect(stdout, stdout).toContain("symlink-file:true")
          } finally {
            await rm(linkPath, { force: true })
          }
        })
      }
    }

    it("works with symlinked packages", async () => {
      const linkPath = path.join(testPath, "node_modules/symlink")
      try {
        await mkdir(path.dirname(linkPath), { recursive: true })
        await rm(linkPath, { force: true })
        await symlink("real", linkPath, process.platform === "win32" ? "junction" : "dir")
        const { exitCode, stderr } = await runMain("./fixture/main-hook/symlink/package")
        expect(exitCode, stderr.slice(-4_000)).toBe(0)
      } finally {
        await rm(linkPath, { force: true })
      }
    })
  })
}
