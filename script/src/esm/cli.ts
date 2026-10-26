import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
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
    return path.resolve(root, "dist/script/build-sync-await-dev.js")
  if (relative.startsWith("script/src/"))
    return path.resolve(root, "dist/script", relative.slice(11).replace(/\.ts$/, ".js"))
  if (relative.startsWith("debug/"))
    return path.resolve(root, "dist", relative.replace(/\.ts$/, ".js"))
  return undefined
}

function prepareTestWorkspace(): void {
  const source = path.join(root, "test")
  const target = path.join(root, "dist/test")
  const generated = new Set(
    Object.values(harnessOutputs).map((filename) => filename.slice("dist/test/".length))
  )
  fs.rmSync(target, { recursive: true, force: true })
  fs.cpSync(source, target, {
    recursive: true,
    verbatimSymlinks: true,
    filter(filename) {
      const relative = path.relative(source, filename).split(path.sep).join("/")
      return (
        !/^(?:harness|vitest)(?:\/|$)/.test(relative) &&
        !generated.has(relative) &&
        !/(?:^|\/)(?:\.cache|\.nyc_output|\.pm2|\.node-spawn-wrap-[^/]*)(?:\/|$)/.test(relative) &&
        !/^env\/(?:native-cache|prefix\/(?:bin|node(?:\.exe)?))(?:\/|$)/.test(relative) &&
        !relative.includes("/.local/share/Trash") &&
        !/^fixture\/find-path\/created(?:\/|$)/.test(relative) &&
        !/^fixture\/unsafe-characters\[/.test(relative) &&
        !/^fixture\/main-hook\/symlink\/file\/symlink\./.test(relative) &&
        !/^fixture\/scenario\/(?:ava-nyc-tsc\/.*\.js|webpack\/output\.js)$/.test(relative) &&
        !/\.(?:node|obj|lib|exp)$/.test(relative) &&
        relative !== "node_modules/symlink"
      )
    }
  })
  // Native scenario executables use ../node_modules. The junction also works
  // on Windows without the privileges needed for file symlinks.
  const dependencies = path.join(root, "dist/node_modules")
  if (!fs.lstatSync(dependencies, { throwIfNoEntry: false })?.isSymbolicLink()) {
    fs.rmSync(dependencies, { recursive: true, force: true })
    fs.symlinkSync(path.join(root, "node_modules"), dependencies, "junction")
  }
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
  const esmTooling = relative.startsWith("script/src/esm/") || relative.startsWith("config/")
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
    // The native TypeScript CLI and its checker helpers run from source.
    // They have no generated consumers and need no copied ESM package config.
    if (filename === path.join(root, "script/src/esm")) continue
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
    checkConfig("config/tsconfig.tooling.json")
    checkConfig("config/tsconfig.bootstrap.json")
    checkConfig("config/tsconfig.harness.json")
    if (["build", "test", "run-test262", "setup-native-addon"].includes(task))
      prepareTestWorkspace()
    // Keep the public installer while replacing generated development commands.
    const scriptDirectory = path.join(root, "dist/script")
    fs.mkdirSync(scriptDirectory, { recursive: true })
    for (const entry of fs.readdirSync(scriptDirectory, { withFileTypes: true })) {
      if (
        entry.name === "esm" ||
        (entry.isFile() &&
          /\.(?:[cm]?js|d\.[cm]?ts)$/.test(entry.name) &&
          entry.name !== "build-sync-await.js")
      )
        fs.rmSync(path.join(scriptDirectory, entry.name), { recursive: true, force: true })
    }
    for (const directory of ["script/src", "debug", "test/harness"])
      emitTree(path.join(root, directory))
    const command = outputPath(path.join(root, "script/src", task + ".ts"))!
    if (task === "test-verdaccio") {
      // Await the complete registry lifecycle, including teardown. A pending
      // task cannot silently succeed because its CommonJS entry ran out of handles.
      const registry = createRequire(import.meta.url)(
        command
      ) as typeof import("../test-verdaccio.js")
      await registry.runRegistryTest(process.argv.slice(3))
    } else {
      const result = spawnSync(process.execPath, [command, ...process.argv.slice(3)], {
        cwd: root,
        stdio: "inherit",
        env: process.env
      })
      if (result.error) throw result.error
      process.exitCode = result.status ?? 1
    }
  }
} catch (error) {
  // The Verdaccio runner has already printed the failed stage and its summary.
  // Avoid repeating the full execa stack unless detailed logging was requested.
  console.error(
    task === "test-verdaccio" && process.argv.includes("--verbose")
      ? error
      : error instanceof Error
        ? error.message
        : error
  )
  process.exitCode = 1
}
