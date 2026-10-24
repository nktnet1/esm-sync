import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import ts from "typescript"
import { checkTypeSafety } from "./check-type-safety.mts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const host: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (name) => name,
  getCurrentDirectory: () => root,
  getNewLine: () => "\n"
}

function checkConfig(filename: string, emit = false, audit = false): void {
  const configPath = path.resolve(root, filename)
  const source = ts.readConfigFile(configPath, ts.sys.readFile)
  if (source.error) throw new Error(ts.formatDiagnosticsWithColorAndContext([source.error], host))
  const config = ts.parseJsonConfigFileContent(
    source.config,
    ts.sys,
    path.dirname(configPath),
    emit ? {} : { noEmit: true },
    configPath
  )
  const program = ts.createProgram(config.fileNames, config.options)
  const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)]
  if (diagnostics.length)
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host))
  if (audit) checkTypeSafety(program, root)
  if (emit) {
    const output = program.emit()
    if (output.emitSkipped || output.diagnostics.length)
      throw new Error(ts.formatDiagnosticsWithColorAndContext(output.diagnostics, host))
  }
}

function emitTree(directory: string, destination: string): void {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    const output = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      emitTree(filename, output)
      continue
    }
    if (!/\.(?:[cm]?ts)$/.test(filename) || /\.d\.[cm]?ts$/.test(filename)) continue
    const suffix = filename.endsWith(".mts") ? ".mjs" : filename.endsWith(".cts") ? ".cjs" : ".js"
    const bootstrap = directory.startsWith(path.join(root, "bootstrap"))
    const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        target: bootstrap ? ts.ScriptTarget.ES2015 : ts.ScriptTarget.ESNext,
        module: suffix === ".cjs" || bootstrap ? ts.ModuleKind.NodeNext : ts.ModuleKind.Preserve,
        esModuleInterop: true
      },
      reportDiagnostics: true
    })
    if (result.diagnostics?.length)
      throw new Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, host))
    let code = result.outputText
    if (filename === path.join(root, "bootstrap", "esm.ts"))
      code = code.replace(/^"use strict";\r?\n/, "")
    const target = output.replace(/\.[cm]?ts$/, suffix)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, code)
  }
}

const task = process.argv[2]
try {
  checkConfig("tsconfig.tooling.json", true)
  if (task === "typecheck") {
    createRequire(import.meta.url)(path.join(root, "script/check-typescript.js"))
    if (process.exitCode) throw new Error("TypeScript dependency version check failed")
    checkConfig("tsconfig.json", false, true)
    checkConfig("test/fixture/scenario/ava-nyc-tsc/tsconfig.json")
  } else {
    if (
      task === undefined ||
      !/^[a-z][\w-]*$/.test(task) ||
      !fs.existsSync(path.join(root, "tooling", task + ".ts"))
    )
      throw new Error("Unknown tooling task: " + task)
    checkConfig("tsconfig.bootstrap.json")
    checkConfig("tsconfig.harness.json")
    emitTree(path.join(root, "bootstrap"), root)
    emitTree(path.join(root, "diagnostics"), path.join(root, "debug"))
    emitTree(path.join(root, "harness"), path.join(root, "test"))
    const result = spawnSync(
      process.execPath,
      [path.join(root, "script", task + ".js"), ...process.argv.slice(3)],
      { cwd: root, stdio: "inherit", env: process.env }
    )
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
