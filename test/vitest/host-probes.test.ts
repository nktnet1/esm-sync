import { readFile, realpath } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { stripVTControlCharacters } from "node:util"
import { describe, expect, it } from "vitest"
import { rendererErrorProbe } from "../../script/src/esm/host-probes.ts"
import { runCommand } from "../../script/src/esm/verify-hosts-container.ts"
import { withCompatibilityFiles } from "./helpers/coverage.ts"

describe("renderer probe startup", () => {
  it("keeps status colours through piped output and honours the standard opt-out", async () => {
    const output = pathToFileURL(path.resolve("script/src/esm/host-output.ts")).href
    const source = `import {hostCaseLine,hostSection} from ${JSON.stringify(output)}
hostSection(2,3,'Run host checks')
hostCaseLine(7,9,'PASS',691,'disabled','renderer locations')`
    for (const enabled of [true, false]) {
      const result = await runCommand(
        process.execPath,
        ["--input-type=module", "-e", source],
        process.cwd(),
        {
          ...process.env,
          TERM: "xterm",
          FORCE_COLOR: enabled ? "1" : undefined,
          NO_COLOR: enabled ? undefined : "1"
        }
      )
      expect(result.code, result.stderr).toBe(0)
      expect(stripVTControlCharacters(result.stdout) !== result.stdout).toBe(enabled)
      expect(result.stdout).toContain("[Step 2/3]")
      expect(result.stdout).toContain("[7/9]")
      expect(result.stdout).toContain("renderer locations")
    }
  })

  for (const mode of ["success", "stalled-command", "failed-navigation", "detached"] as const) {
    it(`handles ${mode} without waiting indefinitely for a debugger response`, async () => {
      await withCompatibilityFiles(
        {
          "probe.cjs": rendererErrorProbe,
          "index.html": "<!doctype html>",
          "syntax.js": "// Mock host source, not an actual renderer execution.\n",
          "runtime.js": "// Mock host source, not an actual renderer execution.\n",
          "node_modules/esm/dist/esm.js": "// Mock host loader path.\n",
          "index.cjs": `const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const {EventEmitter} = require('node:events')
const config = JSON.parse(process.env.ESM_HOST_CHECK)
const mode = process.env.PROBE_TEST_MODE
const events = []
const errors = []
let loaded = false
const nativeTimeout = setTimeout
global.setTimeout = (callback,delay,...args) => nativeTimeout(callback,delay === 45000 ? 1000 : delay >= 5000 ? 100 : Math.min(delay,5),...args)
process.versions.electron = '8.0.0'
const app = new EventEmitter()
app.exit = code => {
  fs.writeFileSync(path.join(config.project,'events.json'),JSON.stringify(events))
  process.exit(code)
}
app.quit = () => { events.push('quit'); app.exit(process.exitCode || 0) }
const debuggerClient = new EventEmitter()
debuggerClient.attach = () => events.push('attach')
debuggerClient.detach = () => debuggerClient.emit('detach',{},'manual')
debuggerClient.isAttached = () => true
debuggerClient.sendCommand = method => {
  events.push(method)
  // Electron can leave commands pending until the first navigation. The old
  // probe deadlocks here because it has not yet called loadFile().
  if (!loaded || mode === 'stalled-command') return new Promise(() => {})
  if (mode === 'detached') debuggerClient.emit('detach',{},'test-target-closed')
  return Promise.resolve({})
}
class BrowserWindow extends EventEmitter {
  constructor() {
    super()
    this.webContents = new EventEmitter()
    this.webContents.debugger = debuggerClient
    this.webContents.reload = () => { events.push('reload'); setImmediate(() => this.webContents.emit('did-finish-load')) }
    this.webContents.executeJavaScript = async source => {
      if (source.includes('loader:require.resolve')) return {loader:config.loader,healthy:true,type:'renderer',versions:{electron:'8.0.0'}}
      if (source === 'window.__esmErrorReports') return errors
      if (source.startsWith('window.__esmTriggerError(')) {
        const kind = JSON.parse(source.slice(source.indexOf('(')+1,-1))
        const filename = path.join(config.project,kind+'.js')
        errors.push({filename,line:2,column:3,stack:filename+':2:3',defaultPrevented:false})
        this.webContents.emit('console-message',{},3,'Uncaught mock error',2,filename)
        debuggerClient.emit('message',{},'Runtime.exceptionThrown',{exceptionDetails:{url:filename,lineNumber:1,columnNumber:2,stackTrace:{callFrames:[{url:filename,lineNumber:1}]}}})
        return
      }
      throw new Error('Unexpected renderer expression: '+source)
    }
  }
  async loadFile() {
    events.push('load')
    if (mode === 'failed-navigation') throw new Error('test-navigation-failed')
    loaded = true
  }
  isDestroyed() { return false }
  close() { this.emit('closed') }
}
const nativeLoad = Module._load
Module._load = function(id) { return id === 'electron' ? {app,BrowserWindow} : Reflect.apply(nativeLoad,this,arguments) }
require('./probe.cjs')
setImmediate(() => app.emit('ready'))`
        },
        async (directory) => {
          const resultFile = path.join(directory, "result.json")
          const result = await runCommand(
            process.execPath,
            ["index.cjs"],
            directory,
            {
              ...process.env,
              PROBE_TEST_MODE: mode,
              ESM_HOST_CHECK: JSON.stringify({
                issue: 691,
                phase: "disabled",
                nonce: "startup-regression",
                project: directory,
                loader: await realpath(path.join(directory, "node_modules/esm/dist/esm.js")),
                result: resultFile
              })
            },
            5000
          )
          const report = JSON.parse(await readFile(resultFile, "utf8")) as {
            passed: boolean
            stage?: string
            errors: string[]
            cases: unknown[]
          }
          const events = JSON.parse(
            await readFile(path.join(directory, "events.json"), "utf8")
          ) as string[]
          if (mode === "success") {
            expect(result.code, result.stderr).toBe(0)
            expect(report.passed).toBe(true)
            expect(report.cases).toHaveLength(2)
            expect(events.indexOf("load")).toBeLessThan(events.indexOf("Runtime.enable"))
            expect(events).toContain("reload")
            expect(events).toContain("quit")
          } else {
            expect(result.code).toBe(1)
            expect(report.passed).toBe(false)
            expect(report.errors.join("\n")).toMatch(
              mode === "failed-navigation"
                ? /test-navigation-failed/
                : mode === "detached"
                  ? /test-target-closed/
                  : /Runtime.enable/
            )
            expect(report.errors.join("\n")).not.toMatch(/Renderer error verification timed out/)
            expect(report.stage).toBeDefined()
          }
        }
      )
    })
  }
})
