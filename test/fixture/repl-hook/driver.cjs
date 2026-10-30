"use strict"

// Node's `-i` flag installs esm-sync's real REPL hook before this preload
// creates a REPL server. Use in-memory streams to exercise REPLServer.eval
// without having a second REPL compete for the process's stdin.
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const repl = require("node:repl")
const { PassThrough } = require("node:stream")
const vm = require("node:vm")
const { pathToFileURL } = require("node:url")

const scenario = process.env.ESM_SYNC_REPL_CASE
const server = repl.start({
  input: new PassThrough(),
  output: new PassThrough(),
  terminal: false,
  prompt: scenario === "custom" ? "app > " : "",
  useColors: scenario === "custom",
  useGlobal: scenario === "global",
  replMode: repl.REPL_MODE_SLOPPY
})

const context = server.context
const timeout = setTimeout(() => finish(new Error(`REPL scenario timed out: ${scenario}`)), 10_000)

function evaluate(code) {
  return new Promise((resolve, reject) => {
    server.eval(code, context, "repl", (error, value) => {
      if (error) reject(error)
      else resolve(value)
    })
  })
}

async function run() {
  switch (scenario) {
    case "global": {
      assert.strictEqual(context, globalThis)
      assert.equal(typeof globalThis.globalAssert, "undefined")
      await evaluate('import { default as globalAssert } from "assert"')
      assert.equal(typeof globalThis.globalAssert, "function")
      break
    }
    case "non-global": {
      assert.notStrictEqual(context, globalThis)
      assert.equal(typeof globalThis.localAssert, "undefined")
      await evaluate('import { default as localAssert } from "assert"')
      assert.equal(typeof context.localAssert, "function")
      assert.equal(typeof globalThis.localAssert, "undefined")
      break
    }
    case "custom": {
      await evaluate('import { join } from "node:path"')
      assert.equal(context.join("parent", "child"), path.join("parent", "child"))
      await evaluate('import { User } from "./fixture/repl-hook/model.mjs"')
      assert.equal(context.User.kind, "local")
      await evaluate('import { sep as separator } from "path"')
      assert.equal(context.separator, path.sep)
      assert.equal(vm.createScript("3 + 5").runInThisContext(), 8)

      const otherServer = repl.start({
        input: new PassThrough(),
        output: new PassThrough(),
        terminal: false,
        prompt: "other > "
      })
      try {
        await new Promise((resolve, reject) => {
          otherServer.eval('import { basename as base } from "path"', otherServer.context, "repl", (error) => {
            if (error) reject(error)
            else resolve()
          })
        })
        assert.equal(otherServer.context.base("path/file.txt"), "file.txt")
        await evaluate('import { dirname as dir } from "path"')
        assert.equal(context.dir("path/file.txt"), "path")
        assert.equal(vm.createScript("7 * 6").runInThisContext(), 42)
      } finally {
        otherServer.close()
      }
      break
    }
    case "module-exports": {
      await evaluate("var exports = module.exports")
      assert.strictEqual(Object.getPrototypeOf(context.exports), Object.prototype)
      break
    }
    case "json": {
      const pkgPath = path.resolve(__dirname, "../../../../package.json")
      const pkgURL = pathToFileURL(pkgPath).href
      const pkgJSON = JSON.parse(readFileSync(pkgPath, "utf8"))

      await evaluate(`import staticPkg from ${JSON.stringify(pkgURL)}`)
      await evaluate(`var dynamicPkg = import(${JSON.stringify(pkgURL)})`)

      const dynamic = await context.dynamicPkg
      assert.deepStrictEqual(JSON.parse(JSON.stringify(context.staticPkg)), pkgJSON)
      assert.deepStrictEqual(Object.keys(dynamic).sort(), ["default", ...Object.keys(pkgJSON)].sort())
      assert.deepStrictEqual(JSON.parse(JSON.stringify(dynamic.default)), pkgJSON)
      for (const [key, value] of Object.entries(pkgJSON)) {
        assert.deepStrictEqual(JSON.parse(JSON.stringify(dynamic[key])), value)
      }
      break
    }
    default:
      throw new Error(`Unknown REPL scenario: ${scenario}`)
  }
}

function finish(error) {
  clearTimeout(timeout)
  server.close()
  if (error) {
    process.stderr.write(`${error.stack || error}\n`, () => process.exit(1))
    return
  }
  process.stdout.write(`ESM_SYNC_REPL_OK:${scenario}\n`, () => process.exit(0))
}

run().then(() => finish(), finish)
