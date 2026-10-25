export interface Directive {
  value: { value: string }
}
export interface BabelNode {
  type: string
  directives?: Directive[]
  body?: BabelNode
  params?: BabelNode[]
  operator?: string
  left?: BabelNode
  right?: BabelNode
}
export interface BabelPath {
  node: BabelNode
  isClass(): boolean
  isFunction(): boolean
  isProgram(): boolean
  find(predicate: (path: BabelPath) => boolean | undefined): BabelPath | null
  traverse(visitor: Visitor): void
}
export type Visitor = Record<string, (path: BabelPath) => void>
export interface BabelAPI {
  types: {
    directive(value: { value: string }): Directive
    directiveLiteral(value: string): { value: string }
  }
}
export interface Plugin {
  visitor: Visitor
}
export type PluginFactory = (babel: BabelAPI) => Plugin
