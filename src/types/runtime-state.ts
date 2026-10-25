import type Entry from "../entry.js"
import type { Getter, Setter, RuntimeRequire } from "./runtime.js"

export type SetterArgs = [string, string[] | null, Setter][]
export type ModuleWrapper = (this: unknown, exports?: unknown, require?: RuntimeRequire) => unknown
export interface RuntimeMethods {
  importedTarget(name: string): { value: unknown }
  addDefaultValue(value: unknown): void
  addExportFromSetter(importedName: string, exportedName?: string, preserveGetter?: boolean): Setter
  addExportGetters(getters: [string, Getter][]): void
  addNamespaceSetter(): Setter
  assertImportedBinding<T>(name: string, value: T): T
  assertUndeclared(name: string): unknown
  compileEval(content: unknown): unknown
  compileGlobalEval(content: unknown): unknown
  importDeferred(request: string, setters: SetterArgs, isDynamic?: boolean): Entry
  dynamicSourceImport(request: unknown, options?: unknown): Promise<unknown>
  dynamicDeferImport(request: unknown, options?: unknown): Promise<unknown>
  dynamicImport(request: unknown, options?: unknown, phase?: string): Promise<unknown>
  globalEval(content: unknown): unknown
  import(request: string, setters: SetterArgs, moduleType?: string): Entry | null | undefined
  initBindings(names: string[]): void
  resumeChildren(): void
  run(wrapper: ModuleWrapper): unknown
  throwConstAssignment(...args: unknown[]): never
  updateBindings<T>(value: T): T
}
export interface RuntimeState extends RuntimeMethods {
  entry: Entry
  global: typeof globalThis
  meta: { url: string | null }
  runResult: unknown
  syncAwait: typeof import("../module/internal/sync-await.js").makeAwait
  _: RuntimeState
  a: RuntimeMethods["assertImportedBinding"]
  b: RuntimeMethods["throwConstAssignment"]
  c: RuntimeMethods["compileEval"]
  d: RuntimeMethods["addDefaultValue"]
  e: RuntimeMethods["globalEval"]
  f: RuntimeMethods["addExportFromSetter"]
  g: typeof globalThis
  i: RuntimeMethods["dynamicImport"]
  j: RuntimeMethods["initBindings"]
  h: RuntimeState["syncAwait"]
  A: typeof import("../module/internal/async-syntax.js").asyncIterator
  B: RuntimeMethods["importedTarget"]
  R: typeof import("../module/internal/async-syntax.js").resources
  k: <T>(value: T) => T
  n: RuntimeMethods["addNamespaceSetter"]
  o: object
  p: RuntimeMethods["dynamicSourceImport"]
  q: RuntimeMethods["dynamicDeferImport"]
  r: RuntimeMethods["run"]
  s: RuntimeMethods["resumeChildren"]
  t: RuntimeMethods["assertUndeclared"]
  u: RuntimeMethods["updateBindings"]
  v: (value: unknown) => unknown
  w: RuntimeMethods["import"]
  x: RuntimeMethods["addExportGetters"]
  y: RuntimeMethods["importDeferred"]
}
