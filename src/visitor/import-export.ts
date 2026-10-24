type ModuleDeclaration = Extract<
  AstNode,
  {
    type:
      | "ImportDeclaration"
      | "ExportNamedDeclaration"
      | "ExportDefaultDeclaration"
      | "ExportAllDeclaration"
  }
>
interface ImportSpecifierMap {
  key: string
  request: string
  moduleType: string | undefined
  phase: string
  imports: Map<string, string[]>
  reExports: Map<string, string[]>
  namespaceReExports: Map<string, string>
  star: boolean
}
import type { AstNode, Ast } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
import type { VisitorOptions } from "../types/visitor.js"
type Options = Pick<
  VisitorOptions,
  | "magicString"
  | "generateVarDeclarations"
  | "possibleIndexes"
  | "runtimeName"
  | "sourceType"
  | "top"
  | "yieldIndex"
>
import COMPILER from "../constant/compiler.js"

import Visitor from "../visitor.js"

import encodeId from "../util/encode-id.js"
import errors from "../parse/errors.js"
import getNamesFromPattern from "../parse/get-names-from-pattern.js"
import { lineBreakRegExp } from "../acorn.js"
import overwrite from "../parse/overwrite.js"
import preserveChild from "../parse/preserve-child.js"
import preserveLine from "../parse/preserve-line.js"
import shared from "../shared.js"
import toStringLiteral from "../util/to-string-literal.js"

function getModuleExportName(
  node: Ast<import("acorn").Identifier | import("acorn").Literal>
): string {
  return node.type === "Literal" ? String(node.value) : node.name
}

function getExportedName(
  specifier:
    | Ast<import("acorn").ExportSpecifier>
    | Extract<AstNode, { type: "ExportNamespaceSpecifier" }>
): string {
  return specifier.exported && getModuleExportName(specifier.exported)
}

function init() {
  const {
    SOURCE_TYPE_MODULE,
    TRANSFORMS_DYNAMIC_IMPORT,
    TRANSFORMS_EXPORT,
    TRANSFORMS_IMPORT,
    TRANSFORMS_IMPORT_META
  } = COMPILER

  class ImportExportVisitor extends Visitor<Options> {
    declare assignableBindings: Set<string>
    declare firstLineBreakPos: number
    declare hoistedExports: [string, string][]
    declare hoistedImportsString: string
    declare importSpecifierMap: Map<string, ImportSpecifierMap>
    declare importedBindingMap: Map<string, { key: string; name: string }>
    declare temporalBindings: Set<string>
    get magicString(): Options["magicString"] {
      return this.currentOptions.magicString
    }
    get generateVarDeclarations(): Options["generateVarDeclarations"] {
      return this.currentOptions.generateVarDeclarations
    }
    get runtimeName(): Options["runtimeName"] {
      return this.currentOptions.runtimeName
    }
    get sourceType(): Options["sourceType"] {
      return this.currentOptions.sourceType
    }
    get top(): Options["top"] {
      return this.currentOptions.top
    }
    declare yieldIndex: number
    finalizeHoisting() {
      const { top } = this
      const { importedBindings } = top

      let code = top.insertPrefix

      if (importedBindings.size !== 0) {
        code +=
          (this.generateVarDeclarations ? "var " : "let ") + [...importedBindings].join(",") + ";"
      }

      // Exports of named imports refer to the original imported binding,
      // not to the intermediate module. Resolve imports after traversal so
      // an export can legally appear before its corresponding import.
      const localExports: [string, string][] = []

      for (const [exportedName, localName] of this.hoistedExports) {
        const imported = this.importedBindingMap.get(localName)

        if (imported === void 0) {
          localExports.push([exportedName, localName])
          continue
        }

        const map = this.importSpecifierMap.get(imported.key)

        if (imported.name === "*") {
          // Keep the local namespace value so CommonJS mocking can replace
          // it, while recording its source for export-star resolution.
          localExports.push([exportedName, localName])
          map!.namespaceReExports.set(exportedName, imported.name)
          continue
        }

        let names = map!.reExports.get(exportedName)

        if (names === void 0) {
          names = []
          map!.reExports.set(exportedName, names)
        }

        names.push(imported.name)
      }

      code += toModuleExport(this, localExports)

      const { runtimeName } = this

      this.importSpecifierMap.forEach((map) => {
        code += runtimeName + (map.phase === "defer" ? ".y(" : ".w(") + toStringLiteral(map.request)

        let setterArgsList = ""

        map.imports.forEach((localNames, name) => {
          const valueParam = safeName("v", localNames)

          setterArgsList +=
            (setterArgsList === "" ? "" : ",") +
            "[" +
            toStringLiteral(name) +
            "," +
            (name === "*"
              ? "null"
              : "[" + localNames.map((localName) => toStringLiteral(localName)).join(",") + "]") +
            ",function(" +
            valueParam +
            "){" +
            localNames.join("=") +
            "=" +
            valueParam +
            "}]"
        })

        map!.reExports.forEach((localNames, name) => {
          for (const localName of localNames) {
            setterArgsList +=
              (setterArgsList === "" ? "" : ",") +
              "[" +
              toStringLiteral(localName) +
              ",null," +
              runtimeName +
              ".f(" +
              toStringLiteral(localName) +
              "," +
              toStringLiteral(name) +
              ")]"
          }
        })

        map!.namespaceReExports.forEach((importedName, exportedName) => {
          setterArgsList +=
            (setterArgsList === "" ? "" : ",") +
            "[" +
            toStringLiteral(importedName) +
            ",null," +
            runtimeName +
            ".f(" +
            toStringLiteral(importedName) +
            "," +
            toStringLiteral(exportedName) +
            ",true)]"
        })

        if (map.star) {
          setterArgsList +=
            (setterArgsList === "" ? "" : ",") + '["*",null,' + runtimeName + ".n()]"
        }

        if (setterArgsList !== "" || map.moduleType === "text") {
          code += ",[" + setterArgsList + "]"
        }

        code += map.moduleType === "text" ? ',"text");' : ");"
      })

      this.magicString.prependLeft(top.insertIndex, code)
      this.yieldIndex += code.length
    }

    reset(options?: Options) {
      this.options = options
      this.assignableBindings = new Set()
      this.firstLineBreakPos = -1
      this.hoistedExports = []
      this.hoistedImportsString = ""
      this.importSpecifierMap = new Map()
      this.importedBindingMap = new Map()
      this.temporalBindings = new Set()
      this.transforms = 0
      this.yieldIndex = options?.yieldIndex ?? 0

      if (options !== void 0) {
        const { magicString } = options

        this.assignableBindings = new Set()
        this.firstLineBreakPos = magicString.original.search(lineBreakRegExp)
        this.hoistedExports = []
        this.importSpecifierMap = new Map()
        this.importedBindingMap = new Map()
        this.temporalBindings = new Set()
      }
    }

    visitCallExpression(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "CallExpression" }>>>
    ) {
      const node = path.getValue()
      const { callee } = node

      if (callee.type !== "Import") {
        this.visitChildren(path)
        return
      }

      if (node.arguments.length === 0) {
        return
      }

      // Support dynamic import calls in the evaluation, source and defer
      // phases. Phase-qualified imports have their own runtime entry points,
      // rather than invoking a property on an imaginary `import` object.
      this.transforms |= TRANSFORMS_DYNAMIC_IMPORT

      const method = callee.phase === "source" ? ".p" : callee.phase === "defer" ? ".q" : ".i"
      overwrite(this, callee.start, callee.end, this.runtimeName + method)
      path.call(this, "visitWithoutReset", "arguments")
    }

    visitImportDeclaration(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "ImportDeclaration" }>>>
    ) {
      if (this.sourceType !== SOURCE_TYPE_MODULE) {
        return
      }

      // Support import statements:
      // import defaultName from "mod"
      // import * as name from "mod"
      // import { export as alias } from "mod"
      // import { export1 , export2, ...exportN } from "mod"
      // import { export1 , export2 as alias2, [...] } from "mod"
      // import defaultName, { export1, [ , [...] ] } from "mod"
      // import defaultName, * as name from "mod"
      // import "mod"
      this.transforms |= TRANSFORMS_IMPORT

      const { importSpecifierMap, temporalBindings } = this
      const node = path.getValue()
      const { specifiers } = node
      const map = getImportSpecifierMap(importSpecifierMap, node)

      const { imports } = map

      for (const specifier of specifiers) {
        const { type } = specifier

        let importsName = "*"

        if (type === "ImportSpecifier") {
          importsName = getModuleExportName(specifier.imported)
        } else if (type === "ImportDefaultSpecifier") {
          importsName = "default"
        }

        let localNames = imports.get(importsName)

        if (localNames === void 0) {
          localNames = []
          imports.set(importsName, localNames)
        }

        const localName = getModuleExportName(specifier.local)

        this.importedBindingMap.set(localName, { key: map.key, name: importsName })

        localNames.push(localName)

        if (importsName !== "*") {
          temporalBindings.add(localName)
        }
      }

      hoistImports(this, node)
    }

    visitExportAllDeclaration(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "ExportAllDeclaration" }>>>
    ) {
      if (this.sourceType !== SOURCE_TYPE_MODULE) {
        return
      }

      // Support re-exporting an imported module:
      // export * from "mod"
      this.transforms |= TRANSFORMS_EXPORT

      const { importSpecifierMap } = this
      const node = path.getValue()
      const map = getImportSpecifierMap(importSpecifierMap, node)

      map.star = true

      hoistImports(this, node)
    }

    visitExportDefaultDeclaration(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "ExportDefaultDeclaration" }>>>
    ) {
      if (this.sourceType !== SOURCE_TYPE_MODULE) {
        return
      }

      this.transforms |= TRANSFORMS_EXPORT

      const node = path.getValue()
      const { declaration } = node
      const { magicString, runtimeName } = this
      const { type } = declaration

      let { id } = declaration

      if (id === void 0) {
        id = null
      }

      const name = id === null ? runtimeName + "anonymous" : id.name

      if ((id !== null && type === "ClassDeclaration") || type === "FunctionDeclaration") {
        // Support exporting default function declarations:
        // export default function named() {}
        if (id === null) {
          // Convert anonymous functions to hoisted named functions.
          magicString.prependLeft(declaration.functionParamsStart!, " " + name)
        }

        hoistExports(this, node, [["default", name]])
      } else {
        // Support exporting other default declarations:
        // export default value
        let prefix = runtimeName + ".d("
        let suffix = ");"

        if (
          id === null &&
          (type === "ArrowFunctionExpression" ||
            type === "ClassDeclaration" ||
            type === "ClassExpression" ||
            type === "FunctionExpression")
        ) {
          // Assign anonymous functions to a variable so they're given a
          // temporary name, which we'll rename later to "default".
          // https://tc39.github.io/ecma262/#sec-exports-runtime-semantics-evaluation
          prefix = "const " + name + "="
          suffix = ";" + runtimeName + ".d(" + name + ");"
        }

        if (type === "SequenceExpression") {
          // If the exported expression is a comma-separated sequence expression
          // it may not include the vital parentheses, so we should wrap the
          // expression with parentheses to make sure it's treated as a single
          // argument to `runtime.addDefaultValue()`, rather than as multiple
          // arguments.
          prefix += "("
          suffix = ")" + suffix
        }

        const localName = id === null ? runtimeName + ".o" : name

        this.hoistedExports.push(["default", localName])

        overwrite(this, node.start, declaration.start, "")
        overwrite(this, declaration.end, node.end, "")

        magicString.prependLeft(declaration.start, prefix).prependRight(declaration.end, suffix)
      }

      if (id !== null) {
        this.assignableBindings.add(name)
      }

      path.call(this, "visitWithoutReset", "declaration")
    }

    visitExportNamedDeclaration(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "ExportNamedDeclaration" }>>>
    ) {
      if (this.sourceType !== SOURCE_TYPE_MODULE) {
        return
      }

      this.transforms |= TRANSFORMS_EXPORT

      const { assignableBindings, magicString } = this
      const node = path.getValue()

      const { declaration, source, specifiers } = node

      if (declaration != null) {
        const pairs: [string, string][] = []
        const { type } = declaration

        if (type === "ClassDeclaration" || type === "FunctionDeclaration") {
          // Support exporting named class and function declarations:
          // export function named() {}
          const { name } = declaration.id

          assignableBindings.add(name)
          pairs.push([name, name])
        } else if (type === "VariableDeclaration") {
          // Skip adding declared names to `this.assignableBindings` if the
          // declaration is a const-kinded VariableDeclaration, because the
          // assignmentVisitor doesn't need to worry about changes to these
          // variables.
          const changeable = isChangeable(node)

          // Support exporting variable lists:
          // export let name1, name2, ..., nameN
          for (const { id } of declaration.declarations) {
            const names = getNamesFromPattern(id)

            for (const name of names) {
              if (changeable) {
                assignableBindings.add(name)
              }

              pairs.push([name, name])
            }
          }
        }

        hoistExports(this, node, pairs)
      } else if (source === null) {
        // Support exporting specifiers:
        // export { name1, name2, ..., nameN }
        const pairs: [string, string][] = []
        const topIdentifiers = this.top.identifiers

        for (const specifier of specifiers) {
          const exportedName = getExportedName(specifier)
          if (specifier.type !== "ExportSpecifier") continue
          const localName = getModuleExportName(specifier.local)

          if (!topIdentifiers.has(localName)) {
            throw new errors.SyntaxError(
              {
                inModule: true,
                input: magicString.original
              },
              specifier.start,
              "Export '" + localName + "' is not defined in module"
            )
          }

          assignableBindings.add(localName)

          pairs.push([exportedName, localName])
        }

        hoistExports(this, node, pairs)
      } else {
        // Support re-exporting specifiers of an imported module:
        // export { name1, name2, ..., nameN } from "mod"
        const { importSpecifierMap } = this
        const map = getImportSpecifierMap(importSpecifierMap, node)

        for (const specifier of specifiers) {
          const exportedName = getExportedName(specifier)
          const { reExports } = map

          let localNames = reExports.get(exportedName)

          if (localNames === void 0) {
            localNames = []
            reExports.set(exportedName, localNames)
          }

          const localName =
            specifier.type === "ExportNamespaceSpecifier"
              ? "*"
              : getModuleExportName(specifier.local)

          localNames.push(localName)
        }

        hoistImports(this, node)
      }

      if (declaration != null) {
        path.call(this, "visitWithoutReset", "declaration")
      }
    }

    visitMetaProperty(
      path: InstanceType<typeof FastPath<Extract<AstNode, { type: "MetaProperty" }>>>
    ) {
      const { meta } = path.getValue()

      if (meta.name === "import") {
        // Support import.meta.
        this.transforms |= TRANSFORMS_IMPORT_META

        overwrite(this, meta.start, meta.end, this.runtimeName + "._")
      }
    }
  }

  function getImportSpecifierMap(
    maps: Map<string, ImportSpecifierMap>,
    node: Exclude<ModuleDeclaration, { type: "ExportDefaultDeclaration" }>
  ): ImportSpecifierMap {
    const request = node.source?.value
    if (typeof request !== "string") throw new TypeError("Expected a module specifier")
    const attribute = (node.attributes ?? []).find(
      ({ key }) => (key.type === "Identifier" ? key.name : key.value) === "type"
    )
    const moduleType = attribute?.value.value === "text" ? "text" : void 0
    const phase = node.phase === "defer" ? "defer" : "evaluation"
    const key =
      request + (moduleType === "text" ? "\0text" : "") + (phase === "defer" ? "\0defer" : "")

    let map = maps.get(key)

    if (map === void 0) {
      map = createImportSpecifierMap()
      map.key = key
      map.request = request
      map.moduleType = moduleType
      map.phase = phase
      maps.set(key, map)
    }

    return map
  }

  function createImportSpecifierMap(): ImportSpecifierMap {
    return {
      key: "",
      request: "",
      moduleType: void 0,
      phase: "evaluation",
      imports: new Map(),
      reExports: new Map(),
      namespaceReExports: new Map(),
      star: false
    }
  }

  function hoistExports(
    visitor: ImportExportVisitor,
    node: Exclude<ModuleDeclaration, { type: "ImportDeclaration" | "ExportAllDeclaration" }>,
    pairs: [string, string][]
  ) {
    visitor.hoistedExports.push(...pairs)

    if (node.declaration) {
      preserveChild(visitor, node, "declaration")
    } else {
      preserveLine(visitor, node)
    }
  }

  function hoistImports(visitor: ImportExportVisitor, node: AstNode) {
    preserveLine(visitor, node)
  }

  function isChangeable(
    node: Exclude<ModuleDeclaration, { type: "ImportDeclaration" | "ExportAllDeclaration" }>
  ): boolean {
    const { type, declaration } = node
    if (type === "ExportDefaultDeclaration") {
      const declType = declaration.type

      return declType === "FunctionDeclaration" || declType === "ClassDeclaration"
    }

    if (
      type === "ExportNamedDeclaration" &&
      declaration != null &&
      declaration.type === "VariableDeclaration" &&
      declaration.kind === "const"
    ) {
      return false
    }

    return true
  }

  function safeName(name: string, localNames: string[]): string {
    return localNames.indexOf(name) === -1 ? name : safeName(encodeId(name), localNames)
  }

  function toModuleExport(visitor: ImportExportVisitor, pairs: [string, string][]) {
    let code = ""

    const { length } = pairs

    if (length === 0) {
      return code
    }

    const lastIndex = length - 1

    let i = -1

    code += visitor.runtimeName + ".x(["

    for (const [exportedName, localName] of pairs) {
      code +=
        "[" +
        toStringLiteral(exportedName) +
        ",()=>" +
        localName +
        "]" +
        (++i === lastIndex ? "" : ",")
    }

    code += "]);"

    return code
  }

  return new ImportExportVisitor()
}

export default shared.inited
  ? shared.module.visitorImportExport
  : (shared.module.visitorImportExport = init())

export type CachedModule = ReturnType<typeof init>
