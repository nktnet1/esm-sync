import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import ts from "typescript"
import { checkTypeSafety } from "./check-type-safety.ts"
import { checkTypeScriptVersion } from "./check-typescript-version.ts"
import { harnessOutputs } from "./outputs.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const host: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (name) => name,
  getCurrentDirectory: () => root,
  getNewLine: () => "\n"
}

function checkConfig(filename: string, audit = false): void {
  const configPath = path.resolve(root, filename)
  const source = ts.readConfigFile(configPath, ts.sys.readFile)
  if (source.error) throw new Error(ts.formatDiagnosticsWithColorAndContext([source.error], host))
  const config = ts.parseJsonConfigFileContent(
    source.config,
    ts.sys,
    path.dirname(configPath),
    { noEmit: true },
    configPath
  )
  const program = ts.createProgram(config.fileNames, config.options)
  const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)]
  if (diagnostics.length)
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host))
  if (audit) checkTypeSafety(program, root)
}

function outputPath(filename: string): string | undefined {
  const relative = path.relative(root, filename).split(path.sep).join("/")
  if (relative in harnessOutputs) return path.resolve(root, harnessOutputs[relative]!)
  if (relative.startsWith("tooling/"))
    return path.resolve(root, "script", relative.slice(8).replace(/\.ts$/, ".js"))
  if (relative.startsWith("bootstrap/"))
    return path.resolve(root, relative.slice(10).replace(/\.ts$/, ".js"))
  if (relative.startsWith("diagnostics/"))
    return path.resolve(root, "debug", relative.slice(12).replace(/\.ts$/, ".js"))
  return undefined
}

// Resolve source helpers to their generated compatibility filenames. Fixture
// imports retain their original text and remain inputs to the loader under test.
function rewriteSpecifier(filename: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier
  const resolved = path.resolve(path.dirname(filename), specifier)
  const base = resolved.replace(/\.[cm]?js$/, "")
  const source = [base + ".ts", base + ".cts"].find((candidate) => fs.existsSync(candidate))
  const importedOutput = source === undefined ? undefined : outputPath(source)
  const currentOutput = outputPath(filename)
  if (importedOutput === undefined || currentOutput === undefined) return specifier
  const relative = path
    .relative(path.dirname(currentOutput), importedOutput)
    .split(path.sep)
    .join("/")
  return relative.startsWith(".") ? relative : "./" + relative
}

function importPaths(filename: string): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    function visit(node: ts.Node): ts.VisitResult<ts.Node> {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        return ts.factory.updateImportDeclaration(
          node,
          node.modifiers,
          node.importClause,
          ts.factory.createStringLiteral(rewriteSpecifier(filename, node.moduleSpecifier.text)),
          node.attributes
        )
      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        return ts.factory.updateCallExpression(
          node,
          node.expression,
          node.typeArguments,
          node.arguments.map((argument) =>
            ts.isStringLiteral(argument)
              ? ts.factory.createStringLiteral(rewriteSpecifier(filename, argument.text))
              : argument
          )
        )
      }
      return ts.visitEachChild(node, visit, context)
    }
    return (file) => ts.visitEachChild(file, visit, context)
  }
}

function emitFile(filename: string, target: string): void {
  const relative = path.relative(root, filename).split(path.sep).join("/")
  const bootstrap = relative.startsWith("bootstrap/")
  const esmTooling = relative.startsWith("tooling/esm/")
  const commonjs =
    bootstrap || (relative.startsWith("tooling/") && !esmTooling) || filename.endsWith(".cts")
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target:
        bootstrap || relative.startsWith("tooling/")
          ? ts.ScriptTarget.ES2015
          : ts.ScriptTarget.ESNext,
      module: commonjs ? ts.ModuleKind.NodeNext : ts.ModuleKind.Preserve,
      esModuleInterop: true,
      rewriteRelativeImportExtensions: esmTooling
    },
    transformers: { before: [importPaths(filename)] },
    reportDiagnostics: true
  })
  if (result.diagnostics?.length)
    throw new Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, host))
  let code = result.outputText
  if (relative === "bootstrap/esm.ts") code = code.replace(/^"use strict";\r?\n/, "")
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, code)
}

function emitTree(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) emitTree(filename)
    else if (/\.[cm]?ts$/.test(filename) && !/\.d\.[cm]?ts$/.test(filename)) {
      const target = outputPath(filename)
      if (target === undefined) throw new Error("Missing generated output mapping: " + filename)
      emitFile(filename, target)
    }
  }
}

const task = process.argv[2]
try {
  checkTypeScriptVersion(root)
  if (task === "typecheck") {
    checkConfig("tsconfig.json", true)
    checkConfig("test/fixture/scenario/ava-nyc-tsc/tsconfig.json")
  } else {
    if (
      task === undefined ||
      !/^[a-z][\w-]*$/.test(task) ||
      !fs.existsSync(path.join(root, "tooling", task + ".ts"))
    )
      throw new Error("Unknown tooling task: " + task)
    checkConfig("tsconfig.tooling.json")
    checkConfig("tsconfig.bootstrap.json")
    checkConfig("tsconfig.harness.json")
    // This directory contains only generated commands. Clear the previous
    // declaration-emitting layout and stale commands before writing JavaScript.
    fs.rmSync(path.join(root, "script"), { recursive: true, force: true })
    for (const directory of ["tooling", "bootstrap", "diagnostics", "harness"])
      emitTree(path.join(root, directory))
    fs.copyFileSync(
      path.join(root, "tooling/esm/package.json"),
      path.join(root, "script/esm/package.json")
    )
    fs.copyFileSync(path.join(root, "script/esm/ncurc.js"), path.join(root, ".ncurc.mjs"))
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
