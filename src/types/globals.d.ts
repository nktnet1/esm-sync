import type { SharedState, RuntimeRequire, ModuleRecord } from "./runtime.js"
declare global {
  var __shared__: SharedState
  var __non_webpack_require__: RuntimeRequire
  var __non_webpack_module__: ModuleRecord
  var __external__: Pick<
    typeof globalThis,
    | "Array"
    | "Buffer"
    | "Error"
    | "EvalError"
    | "Function"
    | "JSON"
    | "Object"
    | "Promise"
    | "RangeError"
    | "ReferenceError"
    | "Reflect"
    | "SyntaxError"
    | "TypeError"
    | "URIError"
    | "eval"
  >
  var __global__: typeof globalThis
  const __ESM_PACKAGE_VERSION__: string
  const __ESM_PACKAGE_FILENAMES__: string[]
  interface Object {
    __defineGetter__(name: PropertyKey, getter: () => unknown): void
    __defineSetter__(name: PropertyKey, setter: (value: unknown) => void): void
    __lookupGetter__(name: PropertyKey): (() => unknown) | undefined
    __lookupSetter__(name: PropertyKey): ((value: unknown) => void) | undefined
  }
}
