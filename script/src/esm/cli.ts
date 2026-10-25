import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import ts from "typescript"
import { checkTypeSafety } from "./check-type-safety.ts"
import { checkTypeScriptVersion } from "./check-typescript-version.ts"
import { harnessOutputs } from "./outputs.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
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
  if (relative === "script/src/build-sync-await.ts")
    return path.resolve(root, "script/build-sync-await-dev.js")
  if (relative.startsWith("script/src/"))
    return path.resolve(root, "script", relative.slice(11).replace(/\.ts$/, ".js"))
  if (relative.startsWith("debug/")) return path.resolve(root, relative.replace(/\.ts$/, ".js"))
  return undefined
}

// Resolve source helpers to their generated compatibility filenames. Fixture
// imports retain their original text and remain inputs to the loader under test.
function rewriteSpecifier(filename: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier
  const resolved = path.resolve(path.dirname(filename), specifier)
  const base = resolved.replace(/\.[cm]?[jt]s$/, "")
  const source = [base + ".ts", base + ".cts"].find((candidate) => fs.existsSync(candidate))
  const importedOutput =
    source === undefined ? (specifier.endsWith(".json") ? resolved : undefined) : outputPath(source)
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
  const esmTooling = relative.startsWith("script/src/esm/")
  const commonjs = (relative.startsWith("script/src/") && !esmTooling) || filename.endsWith(".cts")
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target: relative.startsWith("script/src/") ? ts.ScriptTarget.ES2015 : ts.ScriptTarget.ESNext,
      module: commonjs ? ts.ModuleKind.NodeNext : ts.ModuleKind.Preserve,
      esModuleInterop: true,
      rewriteRelativeImportExtensions: esmTooling
    },
    transformers: { before: [importPaths(filename)] },
    reportDiagnostics: true
  })
  if (result.diagnostics?.length)
    throw new Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, host))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, result.outputText)
}

function emitTree(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) emitTree(filename)
    else if (/\.[cm]?ts$/.test(filename) && !/\.d\.[cm]?ts$/.test(filename)) {
      if (filename === fileURLToPath(import.meta.url)) continue
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
      !fs.existsSync(path.join(root, "script/src", task + ".ts"))
    )
      throw new Error("Unknown tooling task: " + task)
    checkConfig("tsconfig.tooling.json")
    checkConfig("tsconfig.bootstrap.json")
    checkConfig("tsconfig.harness.json")
    // Preserve maintained sources and Rspack's public installer while replacing
    // generated development commands and removing old declaration output.
    for (const entry of fs.readdirSync(path.join(root, "script"), { withFileTypes: true })) {
      if (
        entry.name === "esm" ||
        (entry.isFile() &&
          /\.(?:[cm]?js|d\.[cm]?ts)$/.test(entry.name) &&
          entry.name !== "build-sync-await.js")
      )
        fs.rmSync(path.join(root, "script", entry.name), { recursive: true, force: true })
    }
    for (const directory of ["script/src", "debug", "test/harness"])
      emitTree(path.join(root, directory))
    fs.copyFileSync(
      path.join(root, "script/src/esm/package.json"),
      path.join(root, "script/esm/package.json")
    )
    fs.copyFileSync(path.join(root, "script/esm/ncurc.js"), path.join(root, ".ncurc.mjs"))
    const result = spawnSync(
      process.execPath,
      [outputPath(path.join(root, "script/src", task + ".ts"))!, ...process.argv.slice(3)],
      { cwd: root, stdio: "inherit", env: process.env }
    )
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
