import type MagicString from "../magic-string.js"
import type { AstNode, TopLevel } from "./acorn.js"
export interface VisitorOptions {
  possibleIndexes: number[]
  magicString: InstanceType<typeof MagicString>
  runtimeName: string
  assignableBindings: Set<string>
  importedBindings: Set<string>
  temporalBindings: Set<string>
  assignmentTargets: Set<AstNode>
  transformImportBindingAssignments: boolean
  transformInsideFunctions: boolean
  transformOutsideFunctions: boolean
  strict: boolean
  transformUpdateBindings: boolean
  globals: Set<string>
  generateVarDeclarations: boolean
  sourceType: number
  top: TopLevel
  yieldIndex: number
  checkImports: boolean
  undeclared: Set<string>
}
export type ShadowedMap = Map<AstNode, Map<string, AstNode | null>>
