// Keep the native object and its identity. Dynamic reflection must expose unknown
// until the caller has checked the value, rather than propagate stdlib any.
export interface Descriptor extends Omit<PropertyDescriptor, "value" | "get" | "set"> {
  value?: unknown
  get?: (() => unknown) & { erroredEntry?: import("./entry.js").default }
  set?: (value: unknown) => void
}
type NativeReflect = typeof globalThis.Reflect
interface Reflection
  extends Omit<NativeReflect, "get" | "apply" | "construct" | "getOwnPropertyDescriptor"> {
  get<T extends object, K extends keyof T>(target: T, key: K, receiver?: unknown): T[K]
  get(target: object, key: PropertyKey, receiver?: unknown): unknown
  apply<T, A extends unknown[], R>(target: (this: T, ...args: A) => R, thisArg: T, args: A): R
  apply(target: typeof Function.prototype, thisArg: unknown, args: unknown[]): unknown
  construct<T, A extends unknown[]>(
    target: new (...args: A) => T,
    args: A,
    newTarget?: typeof Function.prototype
  ): T
  construct(
    target: typeof Function.prototype,
    args: unknown[],
    newTarget?: typeof Function.prototype
  ): object
  getOwnPropertyDescriptor(target: object, key: PropertyKey): Descriptor | undefined
}
export default globalThis.Reflect as Reflection
