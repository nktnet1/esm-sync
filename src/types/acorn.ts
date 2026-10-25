import type * as A from "acorn"
import type { LineInfo } from "./runtime.js"

type AbsentProperties<T> = {
  [K in Exclude<
    "name" | "operator" | "shorthand" | "computed" | "id" | "expression",
    keyof T
  >]?: undefined
}
type Adapt<T> = T extends A.Node
  ? {
      [K in keyof T]: K extends "callee"
        ? Adapt<T[K]> | ImportKeyword
        : K extends "specifiers"
          ? T extends A.ExportNamedDeclaration
            ? (Ast<A.ExportSpecifier> | ExportNamespaceSpecifier)[]
            : Adapt<T[K]>
          : Adapt<T[K]>
    } & NodeExtras &
      AbsentProperties<T>
  : T extends readonly unknown[]
    ? { [K in keyof T]: Adapt<T[K]> }
    : T
interface NodeExtras {
  functionParamsStart?: number
  phase?: string
  top?: TopLevel
  inModule?: boolean
  strict?: boolean
}
export interface ImportKeyword extends A.Node {
  name?: undefined
  shorthand?: undefined
  type: "Import"
  phase?: string
}
export interface ExportNamespaceSpecifier extends A.Node {
  shorthand?: undefined
  type: "ExportNamespaceSpecifier"
  exported: Ast<A.Identifier | A.Literal>
}
export interface FieldDefinition extends A.Node {
  shorthand?: undefined
  type: "FieldDefinition"
  key: AstNode
  value: AstNode | null
  computed: boolean
  static: boolean
}
export type Ast<T extends A.Node = A.AnyNode> = Adapt<T>
type WithAbsent<T> = T extends unknown ? T & AbsentProperties<T> : never
export type AstNode = Ast | WithAbsent<ImportKeyword | ExportNamespaceSpecifier | FieldDefinition>
export type Program = Ast<A.Program> & { top: TopLevel; inModule: boolean; strict: boolean }
export interface TopLevel {
  firstAwaitOutsideFunction: LineInfo | null
  firstReturnOutsideFunction: LineInfo | null
  identifiers: Set<string>
  importedBindings: Set<string>
  insertIndex: number
  insertPrefix: string
}
export type MutableNode = A.Node & Record<string, unknown>
export interface ParserOptions extends Omit<A.Options, "sourceType" | "ecmaVersion" | "strict"> {
  ecmaVersion?: A.ecmaVersion
  sourceType?: "module" | "script" | number | undefined
  strict?: boolean | undefined
}
export interface Scope {
  flags: number
  functions: string[]
  lexical: string[]
  var: string[]
}
export interface DestructuringErrors {
  shorthandAssign: number
  trailingComma?: number
  parenthesizedAssign?: number
  parenthesizedBind?: number
  doubleProto?: number
}
export interface TokenType extends A.TokenType {
  startsExpr?: boolean
}
export interface AcornParser {
  options: Omit<ParserOptions, "ecmaVersion"> & { ecmaVersion: number }
  input: string
  start: number
  end: number
  pos: number
  startLoc: LineInfo
  value: unknown
  type: TokenType
  inAsync: boolean
  inFunction: boolean
  inModule: boolean
  inTemplateElement: boolean
  strict: boolean
  containsEsc: boolean
  firstAwaitOutsideFunction: LineInfo | null
  firstReturnOutsideFunction: LineInfo | null
  reservedWords: RegExp
  awaitIdentPos: number
  awaitPos: number
  yieldPos: number
  curLine: number
  exprAllowed: boolean
  lastTokEnd: number
  lastTokStart: number
  lineStart: number
  potentialArrowAt: number
  sourceFile: string | undefined
  scopeStack: Scope[]
  parse(): Program
  next(): void
  startNode(): MutableNode
  startNodeAt(pos: number, loc: LineInfo): MutableNode
  finishNode<T extends AstNode["type"]>(node: MutableNode, type: T): Extract<AstNode, { type: T }>
  finishToken(type: TokenType, value?: unknown): void
  eat(type: TokenType): boolean
  eatContextual(name: string): boolean
  expect(type: TokenType): void
  expectContextual(name: string): void
  isContextual(name: string): boolean
  semicolon(): void
  afterTrailingComma(close: TokenType, notNext?: boolean): boolean
  unexpected(pos?: number): never
  raise(pos: number, message: string): void
  raiseRecoverable(pos: number, message: string): void
  readInt(radix: number, length?: number): number | null
  readWord1(): string
  readNumber(startsWithDot: boolean): void
  readRadixNumber(radix: number): void
  readToken_lt_gt(code: number): void
  readToken_plus_min(code: number): void
  getTokenFromCode(code: number): void
  parseAwait(forInit?: unknown): AstNode
  parseForStatement(node: MutableNode): AstNode
  parseVar(node: MutableNode, isFor: boolean, kind: string): AstNode
  parseReturnStatement(node: MutableNode): AstNode
  parseFunctionParams(node: MutableNode): void
  parseClassElement(constructorAllowsSuper?: boolean): AstNode | null
  parsePropertyName(node: MutableNode): void
  parseExpression(forInit?: boolean): AstNode
  parseMaybeAssign(forInit?: boolean, refDestructuringErrors?: DestructuringErrors): AstNode
  parseExprAtom(refDestructuringErrors?: DestructuringErrors, forInit?: boolean): AstNode
  parseNew(): AstNode
  parseImport(node: MutableNode): AstNode
  parseExport(node: MutableNode, exported: Record<string, boolean>): AstNode
  parseImportNamespaceSpecifier(): Ast<A.ImportNamespaceSpecifier>
  parseModuleExportName(): Ast<A.Identifier | A.Literal>
  parseWithClause(): Ast<A.ImportAttribute>[]
  parseStatement(
    context: string | null,
    topLevel?: boolean,
    exports?: Record<string, boolean>
  ): AstNode
  parseExpressionStatement(node: MutableNode, expression: AstNode): Ast<A.ExpressionStatement>
  parseSubscript(base: AstNode, startPos: number, startLoc: LineInfo, ...args: unknown[]): AstNode
  parseIdent(liberal?: boolean): Ast<A.Identifier>
  parseLiteral(value: unknown): Ast<A.Literal>
  parseTemplateElement(): Ast<A.TemplateElement>
  parseSpread(refDestructuringErrors?: DestructuringErrors): Ast<A.SpreadElement>
  parseExprList(
    close: TokenType,
    allowTrailingComma?: boolean,
    allowEmpty?: boolean,
    refDestructuringErrors?: DestructuringErrors
  ): Array<AstNode | null>
  parseTopLevel(node: MutableNode): Program
  checkExport(exported: Record<string, boolean>, name: unknown, pos: number): void
  checkLVal(expr: AstNode, ...args: unknown[]): void
  checkLValSimple(expr: AstNode, ...args: unknown[]): void
  checkExpressionErrors(errors?: DestructuringErrors): boolean
  enterScope(flags: number): void
  isDirectiveCandidate(...args: unknown[]): boolean
  strictDirective(...args: unknown[]): boolean
  isSimpleParamList(...args: unknown[]): boolean
  adaptDirectivePrologue(...args: unknown[]): void
  checkLocalExport(...args: unknown[]): void
  checkParams(...args: unknown[]): void
  checkPatternErrors(...args: unknown[]): void
  checkPatternExport(...args: unknown[]): void
  checkPropClash(...args: unknown[]): void
  checkVariableExport(...args: unknown[]): void
  checkYieldAwaitInDefaultParams(...args: unknown[]): void
  declareName(...args: unknown[]): void
  invalidStringToken(...args: unknown[]): void
  validateRegExpFlags(...args: unknown[]): void
  validateRegExpPattern(...args: unknown[]): void
}
export interface ParserConstructor {
  new (options: ParserOptions, input: string, startPos?: number): AcornParser
}
export type MethodWrapper<K extends keyof AcornParser> = AcornParser[K] extends (
  ...args: infer P
) => infer R
  ? (this: AcornParser, func: (...args: P) => R, args: P) => R
  : never
