import type { CompilerOptions, ResolvedCompilerOptions, CompiledSource } from "./types/runtime.js"
import type { Program } from "./types/acorn.js"
import Reflect from "./reflection.js"
import COMPILER from "./constant/compiler.js"

import FastPath from "./fast-path.js"
import MagicString from "./magic-string.js"
import Parser from "./parser.js"

import ascendingComparator from "./util/ascending-comparator.js"
import assignmentVisitor from "./visitor/assignment.js"
import evalVisitor from "./visitor/eval.js"
import defaults from "./util/defaults.js"
import findIndexes from "./parse/find-indexes.js"
import globalsVisitor from "./visitor/globals.js"
import hasPragma from "./parse/has-pragma.js"
import importExportVisitor from "./visitor/import-export.js"
import requireVisitor from "./visitor/require.js"
import setDeferred from "./util/set-deferred.js"
import shared from "./shared.js"
import stripShebang from "./util/strip-shebang.js"
import temporalVisitor from "./visitor/temporal.js"
import topLevelAwaitVisitor from "./visitor/top-level-await.js"
import undeclaredVisitor from "./visitor/undeclared.js"

function init() {
  const {
    SOURCE_TYPE_MODULE,
    SOURCE_TYPE_SCRIPT,
    SOURCE_TYPE_UNAMBIGUOUS,
    TRANSFORMS_DYNAMIC_IMPORT,
    TRANSFORMS_EXPORT,
    TRANSFORMS_IMPORT,
    TRANSFORMS_IMPORT_META,
    TRANSFORMS_TEMPORALS
  } = COMPILER

  const defaultOptions: ResolvedCompilerOptions = {
    cjsPaths: false,
    cjsVars: false,
    generateVarDeclarations: false,
    hint: -1,
    pragmas: true,
    runtimeName: "_",
    sourceType: SOURCE_TYPE_SCRIPT,
    strict: void 0,
    topLevelReturn: false,
    transformTopLevelAwait: true
  }

  const Compiler = {
    createOptions,
    defaultOptions,
    compile(input: unknown, value?: CompilerOptions): CompiledSource {
      const code = stripShebang(input)
      const options = Compiler.createOptions(value)

      assignmentVisitor.reset()
      evalVisitor.reset()
      globalsVisitor.reset()
      importExportVisitor.reset()
      requireVisitor.reset()
      temporalVisitor.reset()
      topLevelAwaitVisitor.reset()
      undeclaredVisitor.reset()

      const result: CompiledSource = {
        circular: 0,
        code,
        codeWithTDZ: null,
        filename: null,
        firstAwaitOutsideFunction: null,
        firstReturnOutsideFunction: null,
        mtime: -1,
        scriptData: null,
        sourceType: SOURCE_TYPE_SCRIPT,
        transforms: 0,
        yieldIndex: 0
      }

      const { hint } = options

      let { sourceType } = options

      if (hint === SOURCE_TYPE_SCRIPT) {
        sourceType = SOURCE_TYPE_SCRIPT
      } else if (hint === SOURCE_TYPE_MODULE) {
        sourceType = SOURCE_TYPE_MODULE
      } else if (options.pragmas) {
        if (hasPragma(code, "use module")) {
          sourceType = SOURCE_TYPE_MODULE
        } else if (hasPragma(code, "use script")) {
          sourceType = SOURCE_TYPE_SCRIPT
        }
      }

      const possibleExportIndexes = findIndexes(code, ["export"])
      const possibleEvalIndexes = findIndexes(code, ["eval"])
      const possibleImportExportIndexes = findIndexes(code, ["import"])
      const possibleRequireIndexes = findIndexes(code, ["require"])

      const possibleChanges =
        possibleExportIndexes.length !== 0 ||
        possibleEvalIndexes.length !== 0 ||
        possibleImportExportIndexes.length !== 0 ||
        possibleRequireIndexes.length !== 0

      if (
        !possibleChanges &&
        (sourceType === SOURCE_TYPE_SCRIPT || sourceType === SOURCE_TYPE_UNAMBIGUOUS)
      ) {
        return result
      }

      const parserOptions = {
        allowReturnOutsideFunction: options.topLevelReturn || sourceType === SOURCE_TYPE_SCRIPT,
        sourceType: sourceType === SOURCE_TYPE_SCRIPT ? SOURCE_TYPE_SCRIPT : SOURCE_TYPE_MODULE,
        strict: options.strict
      }

      let ast: Program | undefined
      let error: unknown
      let threw = true

      try {
        ast = Parser.parse(code, parserOptions)
        threw = false
      } catch (e) {
        error = e
      }

      if (threw && sourceType === SOURCE_TYPE_UNAMBIGUOUS) {
        sourceType = SOURCE_TYPE_SCRIPT
        parserOptions.allowReturnOutsideFunction = true
        parserOptions.sourceType = sourceType

        try {
          ast = Parser.parse(code, parserOptions)
          threw = false
        } catch {}
      }

      if (threw) {
        if (options.cjsPaths) {
          if (typeof error === "object" && error !== null) Reflect.set(error, "inModule", false)
        }

        throw error
      }

      const { cjsVars, runtimeName } = options
      if (ast === undefined) throw error
      const { strict, top } = ast
      const topIdentifiers = top.identifiers

      // Delete extraneous properties so they aren't needlessly visited.
      Reflect.deleteProperty(ast, "inModule")
      Reflect.deleteProperty(ast, "strict")
      Reflect.deleteProperty(ast, "top")

      const magicString = new MagicString(code)
      const rootPath = new FastPath(ast!)

      let yieldIndex = top.insertIndex

      possibleImportExportIndexes.push(...possibleExportIndexes)
      possibleImportExportIndexes.sort(ascendingComparator)

      importExportVisitor.visit(rootPath, {
        generateVarDeclarations: options.generateVarDeclarations,
        magicString,
        possibleIndexes: possibleImportExportIndexes,
        runtimeName,
        sourceType: sourceType === SOURCE_TYPE_SCRIPT ? SOURCE_TYPE_SCRIPT : SOURCE_TYPE_MODULE,
        top,
        yieldIndex
      })

      const importExportTransforms = importExportVisitor.transforms
      const transformsDynamicImport = (importExportTransforms & TRANSFORMS_DYNAMIC_IMPORT) !== 0
      const transformsExport = (importExportTransforms & TRANSFORMS_EXPORT) !== 0
      const transformsImport = (importExportTransforms & TRANSFORMS_IMPORT) !== 0
      const transformsImportMeta = (importExportTransforms & TRANSFORMS_IMPORT_META) !== 0

      if (sourceType === SOURCE_TYPE_UNAMBIGUOUS) {
        if (transformsExport || transformsImportMeta || transformsImport) {
          sourceType = SOURCE_TYPE_MODULE
        } else {
          sourceType = SOURCE_TYPE_SCRIPT
        }
      }

      if (transformsDynamicImport || transformsImport) {
        const globals = new Set(["Reflect", "console"])

        const possibleGlobalsNames: string[] = []

        if (topIdentifiers.has("console")) {
          globals.delete("console")
        } else {
          possibleGlobalsNames.push("console")
        }

        if (topIdentifiers.has("Reflect")) {
          globals.delete("Reflect")
        } else {
          possibleGlobalsNames.push("Reflect")
        }

        globalsVisitor.visit(rootPath, {
          globals,
          magicString,
          possibleIndexes: findIndexes(code, possibleGlobalsNames),
          runtimeName
        })
      }

      if (!topIdentifiers.has("eval")) {
        evalVisitor.visit(rootPath, {
          magicString,
          possibleIndexes: possibleEvalIndexes,
          runtimeName,
          strict,
          transformUpdateBindings: transformsExport
        })
      }

      let possibleAssignableBindingsIndexes: number[] | undefined

      if (transformsExport || transformsImport) {
        const { assignableBindings } = importExportVisitor

        possibleAssignableBindingsIndexes = findIndexes(code, [...assignableBindings])

        if (cjsVars) {
          requireVisitor.visit(rootPath, {
            possibleIndexes: findIndexes(code, ["require"])
          })
        }

        const { importedBindings } = top

        const transformImportBindingAssignments =
          !requireVisitor.found && importedBindings.size !== 0

        let possibleAssignmentIndexes = possibleAssignableBindingsIndexes

        if (transformImportBindingAssignments) {
          possibleAssignmentIndexes.push(...findIndexes(code, [...importedBindings]))
          possibleAssignmentIndexes.sort(ascendingComparator)
        }

        assignmentVisitor.visit(rootPath, {
          assignableBindings,
          importedBindings,
          magicString,
          possibleIndexes: possibleAssignmentIndexes,
          runtimeName,
          transformImportBindingAssignments,
          transformOutsideFunctions: false,
          transformInsideFunctions: true
        })

        importExportVisitor.finalizeHoisting()
      }

      if (!cjsVars && sourceType === SOURCE_TYPE_MODULE) {
        const possibleNames = [
          "__dirname",
          "__filename",
          "arguments",
          "exports",
          "module",
          "require"
        ]

        const undeclared = new Set<string>()
        const undeclaredNames: string[] = []

        for (const name of possibleNames) {
          if (!topIdentifiers.has(name)) {
            undeclared.add(name)
            undeclaredNames.push(name)
          }
        }

        undeclaredVisitor.visit(rootPath, {
          magicString,
          possibleIndexes: findIndexes(code, undeclaredNames),
          runtimeName,
          undeclared
        })
      }

      if (
        options.transformTopLevelAwait &&
        sourceType === SOURCE_TYPE_MODULE &&
        (top.firstAwaitOutsideFunction !== null || code.includes("using"))
      ) {
        topLevelAwaitVisitor.visit(rootPath, {
          magicString,
          possibleIndexes: findIndexes(code, ["await", "using"]),
          runtimeName,
          top,
          assignableBindings: importExportVisitor.assignableBindings,
          importedBindings: top.importedBindings,
          checkImports: !requireVisitor.found
        })
      }

      result.transforms =
        topLevelAwaitVisitor.transforms |
        evalVisitor.transforms |
        globalsVisitor.transforms |
        importExportTransforms |
        undeclaredVisitor.transforms

      if (result.transforms !== 0) {
        yieldIndex = importExportVisitor.yieldIndex + topLevelAwaitVisitor.prefixLength

        result.code = magicString.toString()
      }

      if (transformsImport) {
        // Pick `importExportVisitor` properties outside of the `codeWithTDZ`
        // getter/setter to preserve their values.
        const { assignableBindings, temporalBindings } = importExportVisitor
        const { assignmentTargets } = topLevelAwaitVisitor

        setDeferred(result, "codeWithTDZ", () => {
          const possibleTemporalIndexes = findIndexes(code, [...temporalBindings])

          possibleTemporalIndexes.push(...possibleExportIndexes)
          possibleTemporalIndexes.sort(ascendingComparator)

          assignmentVisitor.visit(rootPath, {
            assignableBindings,
            magicString,
            possibleIndexes: possibleAssignableBindingsIndexes!,
            runtimeName,
            importedBindings: new Set<string>(),
            transformImportBindingAssignments: false,
            transformInsideFunctions: false,
            transformOutsideFunctions: true
          })

          temporalVisitor.visit(rootPath, {
            magicString,
            possibleIndexes: possibleTemporalIndexes,
            runtimeName,
            temporalBindings,
            assignmentTargets
          })

          const temporalTransforms = temporalVisitor.transforms

          result.transforms |= temporalTransforms

          return (temporalTransforms & TRANSFORMS_TEMPORALS) === 0 ? null : magicString.toString()
        })

        result.circular = -1
      }

      result.firstAwaitOutsideFunction = top.firstAwaitOutsideFunction
      result.firstReturnOutsideFunction = top.firstReturnOutsideFunction
      result.sourceType = sourceType
      result.yieldIndex = yieldIndex

      return result
    }
  }

  function createOptions(value?: CompilerOptions): ResolvedCompilerOptions {
    return defaults({}, value ?? {}, Compiler.defaultOptions)
  }

  return Compiler
}

export default shared.inited ? shared.module.Compiler : (shared.module.Compiler = init())

export type CachedModule = ReturnType<typeof init>
