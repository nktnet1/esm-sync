import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { performance } from "node:perf_hooks"
import { styleText } from "node:util"
import type {
  FormatDiagnosticsHost,
  Node,
  SourceFile,
  TransformerFactory,
  VisitResult
} from "typescript"
import { harnessOutputs } from "./outputs.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const task = process.argv[2]
const started = performance.now()
let ts: typeof import("typescript")

function duration(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(1)}s`
}

// Wait for stdout to accept each line before entering a synchronous check.
// Otherwise the progress message can remain buffered until the check finishes.
async function announce(category: string, description: string): Promise<void> {
  const color =
    category === "RUN" || category === "CLEAN"
      ? "yellow"
      : category === "CHECK" || category === "AUDIT"
        ? "magenta"
        : "cyan"
  const line = `  ${styleText("dim", "[cli]")} ${styleText(color, category)}${" ".repeat(Math.max(2, 10 - category.length))}${description}\n`
  await new Promise<void>((resolve) => {
    process.stdout.write(line, () => resolve())
  })
}

async function stage<T>(
  category: string,
  description: string,
  action: () => T | Promise<T>
): Promise<T> {
  await announce(category, description)
  const start = performance.now()
  try {
    const result = await action()
    console.log(
      `  ${styleText("dim", "[cli]")}       ${styleText(["bold", "green"], "PASS")}  ${styleText("dim", duration(start))}`
    )
    return result
  } catch (error) {
    console.log(
      `  ${styleText("dim", "[cli]")}       ${styleText(["bold", "red"], "FAIL")}  ${styleText("dim", duration(start))}`
    )
    throw error
  }
}

const host: FormatDiagnosticsHost = {
  getCanonicalFileName: (name) => name,
  getCurrentDirectory: () => root,
  getNewLine: () => "\n"
}

function checkConfig(filename: string): import("typescript").Program {
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
  return program
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

function importPaths(filename: string): TransformerFactory<SourceFile> {
  return (context) => {
    function visit(node: Node): VisitResult<Node> {
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

console.log(
  `\n  ${styleText("dim", "[cli]")} ${styleText(["bold", "blue"], "START")}  ${styleText("cyan", task ?? "(no task)")}  ${styleText("dim", `Node ${process.version}`)}`
)
try {
  // Validate the task before loading TypeScript, so unknown commands fail fast.
  if (
    task !== "typecheck" &&
    (task === undefined ||
      !/^[a-z][\w-]*$/.test(task) ||
      !fs.existsSync(path.join(root, "script/src", task + ".ts")))
  )
    throw new Error("Unknown tooling task: " + task)

  await stage("LOAD", "TypeScript compiler", async () => {
    ts = (await import("typescript")).default
  })
  await stage("VERIFY", "Installed TypeScript version", async () => {
    const { checkTypeScriptVersion } = await import("./check-typescript-version.ts")
    checkTypeScriptVersion(root)
  })

  if (task === "typecheck") {
    const program = await stage("CHECK", "tsconfig.json", () => checkConfig("tsconfig.json"))
    await stage("AUDIT", "Owned TypeScript types", async () => {
      const { checkTypeSafety } = await import("./check-type-safety.ts")
      checkTypeSafety(program, root)
    })
    await stage("CHECK", "AVA fixture TypeScript configuration", () =>
      checkConfig("test/fixture/scenario/ava-nyc-tsc/tsconfig.json")
    )
  } else {
    for (const config of [
      "config/tsconfig.tooling.json",
      "config/tsconfig.bootstrap.json",
      "config/tsconfig.harness.json"
    ])
      await stage("CHECK", config, () => checkConfig(config))

    if (["build", "test", "run-test262", "setup-native-addon"].includes(task))
      await stage("PREPARE", "Copy runtime test fixtures into dist/test", prepareTestWorkspace)

    // Keep the public installer while replacing generated development commands.
    await stage("CLEAN", "Remove old generated tooling files", () => {
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
    })
    for (const directory of ["script/src", "debug", "test/harness"])
      await stage("EMIT", `Generate tooling from ${directory}`, () =>
        emitTree(path.join(root, directory))
      )

    const command = outputPath(path.join(root, "script/src", task + ".ts"))!
    if (task === "test-verdaccio") {
      // Await the complete registry lifecycle, including teardown. A pending
      // task cannot silently succeed because its CommonJS entry ran out of handles.
      await stage("RUN", "Verdaccio publish/install integration test", async () => {
        const registry = createRequire(import.meta.url)(
          command
        ) as typeof import("../test-verdaccio.js")
        await registry.runRegistryTest(process.argv.slice(3))
      })
    } else {
      await announce("RUN", `${task} ${process.argv.slice(3).join(" ")}`.trim())
      const runStarted = performance.now()
      const result = spawnSync(process.execPath, [command, ...process.argv.slice(3)], {
        cwd: root,
        stdio: "inherit",
        env: process.env
      })
      process.exitCode = result.status ?? 1
      console.log(
        `  ${styleText("dim", "[cli]")}       ${styleText(["bold", process.exitCode === 0 ? "green" : "red"], process.exitCode === 0 ? "PASS" : "FAIL")}  ${styleText("dim", duration(runStarted))}`
      )
      if (result.error) throw result.error
    }
  }
  if (!process.exitCode)
    console.log(
      `  ${styleText("dim", "[cli]")} ${styleText(["bold", "green"], "DONE")}  ${styleText("cyan", task)}  ${styleText("dim", `total ${duration(started)}`)}\n`
    )
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
