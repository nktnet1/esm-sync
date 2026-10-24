import type { HookOptions, TestContext, TestOptions } from "node:test"

type Body = (context: TestContext, done: (failure?: unknown) => void) => unknown
interface NativeIt {
  (name: string, body?: Body): Promise<void>
  (name: string, options: TestOptions, body?: Body): Promise<void>
  skip: NativeIt
  only: NativeIt
  todo: NativeIt
}
type Hook = (body: () => unknown, options?: HookOptions) => void
// Node observes promise settlement and ignores a test body's completion value.
export type NativeTests = Omit<
  typeof import("node:test"),
  "it" | "before" | "after" | "beforeEach" | "afterEach"
> & {
  it: NativeIt
  before: Hook
  after: Hook
  beforeEach: Hook
  afterEach: Hook
}
export type Namespace = Record<PropertyKey, unknown>
export interface DefaultFixture {
  default(...args: unknown[]): unknown
}
export interface PhasedFixture {
  source(request: unknown, options?: unknown): Promise<Namespace>
  defer(request: unknown, options?: unknown): Promise<Namespace>
}
export interface TextFixture {
  default: string
}
export interface TextConsumer {
  text: string
  namespace: TextFixture
  reExported: string
  reExportedNamespace: TextFixture
  javascript: number
  rawJavaScript: string
}
export interface LiveFixture {
  value: number
  reset(): number
  add(value: number): void
}
export interface SelfFixture {
  value: number
  getDeferredValue(): number
}
export interface RequireFixture {
  default: import("../src/types/runtime.js").RuntimeRequire
}
export interface ParentFixture {
  child: import("../src/types/runtime.js").ModuleRecord
  parent: import("../src/types/runtime.js").ModuleRecord
}
export type FixtureGlobals = typeof globalThis & {
  esmSyncDeferredWasEvaluated?: boolean
  esmSyncDeferredOriginalError?: unknown
  esmSyncDeferredSelfError?: unknown
  esmSyncDeferredDependencyError?: unknown
  esmSyncDeferredDependencyLeafExecuted?: boolean
  customError?: unknown
  loadCount?: number
}
