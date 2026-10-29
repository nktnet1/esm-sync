type ConsoleObject = Record<PropertyKey, unknown> & { Console?: unknown }
type ConsoleFunction = (this: unknown, ...args: unknown[]) => unknown
type ConsoleWrapper = (this: unknown, func: typeof Function.prototype, args: unknown[]) => unknown
type InspectOptions = import("node:util").InspectOptions
type Streams = { stderr: NodeJS.WritableStream; stdout: NodeJS.WritableStream }
import Reflect from "../reflection.js"
import ENV from "../constant/env.js"

import GenericFunction from "../generic/function.js"
import GenericObject from "../generic/object.js"
import OwnProxy from "../own/proxy.js"

import assign from "../util/assign.js"
import binding from "../binding.js"
import builtinUtil from "./util.js"
import copyProperty from "../util/copy-property.js"
import has from "../util/has.js"
import isNativeLikeFunction from "../util/is-native-like-function.js"
import isObjectLike from "../util/is-object.js"
import isUpdatableDescriptor from "../util/is-updatable-descriptor.js"
import isUpdatableGet from "../util/is-updatable-get.js"
import keys from "../util/keys.js"
import ownKeys from "../util/own-keys.js"
import maskFunction from "../util/mask-function.js"
import realConsole from "../real/console.js"
import safeConsole from "../safe/console.js"
import safeGlobalConsole from "../safe/global-console.js"
import safeProcess from "../safe/process.js"
import satisfies from "../util/satisfies.js"
import setProperty from "../util/set-property.js"
import setPrototypeOf from "../util/set-prototype-of.js"
import shared from "../shared.js"
import toExternalFunction from "../util/to-external-function.js"
import toString from "../util/to-string.js"

const { ELECTRON_RENDERER, FLAGS, HAS_INSPECTOR } = ENV

const SafeConsole = safeConsole.Console
const SafeProto = SafeConsole.prototype
const SafeProtoNames = ownKeys(SafeProto)

const dirOptions = { customInspect: true }
const wrapperMap = createWrapperMap(SafeProto)

let isConsoleSymbol = findByRegExp(Object.getOwnPropertySymbols(safeConsole), /IsConsole/i)

if (typeof isConsoleSymbol !== "symbol") {
  isConsoleSymbol = Symbol("kIsConsole")
}

function assertWrapper(
  this: unknown,
  func: typeof Function.prototype,
  [expression, ...rest]: unknown[]
) {
  return Reflect.apply(func, this, [expression, ...transform(rest, toCustomInspectable)])
}

function createBuiltinConsole(): ConsoleObject {
  const newBuiltinConsole = tryCreateConsole(safeProcess)

  if (newBuiltinConsole === null) {
    return realConsole as unknown as ConsoleObject
  }

  if (HAS_INSPECTOR && FLAGS.inspect) {
    const { consoleCall } = binding.inspector
    const { originalConsole } = shared
    const useConsoleCall = typeof consoleCall === "function"

    // Node 11.11 removed the config argument from consoleCall. Passing it
    // on newer versions logs it as an extra argument in both consoles.
    const configArgs =
      useConsoleCall && satisfies(safeProcess.versions.node, "<11.11.0") ? [{}] : []

    const originalNames = keys(originalConsole)

    for (const name of originalNames) {
      if (!isKeyAssignable(name)) {
        continue
      }

      const originalFunc = Reflect.get(originalConsole, name)

      if (typeof originalFunc === "function") {
        const builtinFunc = newBuiltinConsole[name]

        if (useConsoleCall && typeof builtinFunc === "function" && has(newBuiltinConsole, name)) {
          // Use `consoleCall()` to combine `builtinFunc()` and
          // `originalFunc()` without adding to the call stack.
          setProperty(
            newBuiltinConsole,
            name,
            GenericFunction.bind(
              consoleCall,
              newBuiltinConsole,
              originalFunc,
              builtinFunc,
              ...configArgs
            )
          )
        } else {
          setProperty(newBuiltinConsole, name, originalFunc)
        }
      }
    }
  } else if (ELECTRON_RENDERER) {
    const globalNames = keys(safeGlobalConsole)

    for (const name of globalNames) {
      if (!isKeyAssignable(name)) {
        continue
      }

      const globalFunc = Reflect.get(safeGlobalConsole, name)

      if (typeof globalFunc === "function") {
        setProperty(newBuiltinConsole, name, globalFunc)
      }
    }
  }

  const safeNames = ownKeys(safeConsole)

  for (const name of safeNames) {
    if (isKeyAssignable(name) && !has(newBuiltinConsole, name)) {
      copyProperty(newBuiltinConsole, safeConsole, name)
    }
  }

  newBuiltinConsole.Console = Console

  return newBuiltinConsole
}

function createBuiltinMethodMap(
  consoleObject: ConsoleObject
): Map<unknown, typeof Function.prototype> {
  const names = keys(consoleObject)
  const newBuiltinMethodMap = new Map<unknown, typeof Function.prototype>()

  for (const name of names) {
    const func = Reflect.get(consoleObject, name)
    const globalFunc = Reflect.get(safeGlobalConsole, name)

    if (
      typeof func === "function" &&
      typeof globalFunc === "function" &&
      (!isKeyAssignable(name) || isNativeLikeFunction(globalFunc))
    ) {
      newBuiltinMethodMap.set(globalFunc, func)
    }
  }

  return newBuiltinMethodMap
}

function createConsole({ stderr, stdout }: Streams): ConsoleObject {
  const ConsoleProto = Console.prototype

  const newConsole = Reflect.construct(
    Console,
    shared.support.consoleOptions ? [{ stderr, stdout }] : [stdout, stderr]
  )

  setPrototypeOf(newConsole, GenericObject.create())

  for (const name of SafeProtoNames) {
    if (isKeyAssignable(name) && !has(newConsole, name)) {
      copyProperty(newConsole, ConsoleProto, name)
    }
  }

  return newConsole
}

function createWrapperMap(consoleObject: object): Map<PropertyKey, ConsoleFunction> {
  const wrappedLog = wrapBuiltin(
    Reflect.get(consoleObject, "log") as typeof Function.prototype,
    logWrapper
  )

  const newWrapperMap = new Map<PropertyKey, ConsoleFunction>([
    [
      "assert",
      wrapBuiltin(Reflect.get(consoleObject, "assert") as typeof Function.prototype, assertWrapper)
    ],
    ["debug", wrappedLog],
    [
      "dir",
      wrapBuiltin(Reflect.get(consoleObject, "dir") as typeof Function.prototype, dirWrapper)
    ],
    ["dirxml", wrappedLog],
    ["info", wrappedLog],
    ["log", wrappedLog],
    ["trace", wrapBuiltin(Reflect.get(consoleObject, "trace") as typeof Function.prototype)],
    ["warn", wrapBuiltin(Reflect.get(consoleObject, "warn") as typeof Function.prototype)]
  ])

  const names = keys(consoleObject)

  for (const name of names) {
    if (isKeyAssignable(name) && !newWrapperMap.has(name)) {
      const func = Reflect.get(consoleObject, name)

      if (typeof func === "function") {
        newWrapperMap.set(name, wrapBuiltin(func))
      }
    }
  }

  return newWrapperMap
}

function defaultWrapper(this: unknown, func: typeof Function.prototype, args: unknown[]) {
  return Reflect.apply(func, this, args)
}

function dirWrapper(this: unknown, func: typeof Function.prototype, [object, options]: unknown[]) {
  return Reflect.apply(func, this, [
    {
      [shared.customInspectKey!](recurseTimes: number | null, context: InspectOptions) {
        const contextAsOptions = assign({}, context, options as object)

        contextAsOptions.customInspect = has(options, "customInspect")
          ? Boolean(Reflect.get(Object(options) as object, "customInspect"))
          : false

        contextAsOptions.depth = recurseTimes

        return builtinUtil.inspect(object, contextAsOptions)
      }
    },
    dirOptions
  ])
}

function findByRegExp<T>(array: T[], regexp: RegExp): T | undefined {
  for (const value of array) {
    if (regexp.test(toString(value))) {
      return value
    }
  }
}

function isKeyAssignable(name: PropertyKey): boolean {
  return name !== "Console" && name !== "constructor"
}

function logWrapper(this: unknown, func: typeof Function.prototype, args: unknown[]) {
  return Reflect.apply(func, this, transform(args, toCustomInspectable))
}

function toCustomInspectable(value: unknown): unknown {
  if (!isObjectLike(value)) {
    return value
  }

  return {
    [shared.customInspectKey!](recurseTimes: number | null, context: InspectOptions) {
      const contextAsOptions = assign({}, context)

      contextAsOptions.depth = recurseTimes

      return builtinUtil.inspect(value, contextAsOptions)
    }
  }
}

function transform(array: unknown[], iteratee: (value: unknown) => unknown): unknown[] {
  const { length } = array

  let i = -1

  while (++i < length) {
    array[i] = iteratee(array[i])
  }

  return array
}

function tryCreateConsole(processObject: Streams): ConsoleObject | null {
  try {
    return createConsole(processObject)
  } catch {}

  return null
}

function wrapBuiltin(
  builtinFunc: typeof Function.prototype,
  wrapper: ConsoleWrapper = defaultWrapper
): ConsoleFunction {
  // Define method with shorthand syntax so it's not constructable.
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Method_definitions#Method_definitions_are_not_constructable
  const object = {
    method(this: unknown, ...args: unknown[]) {
      const { defaultInspectOptions } = shared
      const { customInspect } = defaultInspectOptions!

      setProperty(defaultInspectOptions, "customInspect", true)

      try {
        return Reflect.apply(wrapper, this, [builtinFunc, args])
      } finally {
        setProperty(defaultInspectOptions, "customInspect", customInspect)
      }
    }
  }

  return maskFunction(object.method, builtinFunc)
}

const Console = maskFunction(function (this: ConsoleObject, ...args: unknown[]) {
  const newTarget = new.target

  if (newTarget === void 0) {
    return Reflect.construct(Console, args)
  }

  this[isConsoleSymbol!] = true

  const ConsoleProto = Console.prototype
  const ConsoleProtoNames = keys(ConsoleProto)

  for (const name of ConsoleProtoNames) {
    if (isKeyAssignable(name)) {
      const func = this[name]

      if (typeof func === "function") {
        this[name] = GenericFunction.bind(func, this)
      }
    }
  }

  const newSafeConsole = Reflect.construct(SafeConsole, args, newTarget)
  const newSafeNames = ownKeys(newSafeConsole)

  for (const name of newSafeNames) {
    if (isKeyAssignable(name) && !has(this, name)) {
      copyProperty(this, newSafeConsole, name)
    }
  }
}, SafeConsole) as unknown as { new (...args: unknown[]): ConsoleObject; prototype: ConsoleObject }

const ConsoleProto = Console.prototype

for (const name of SafeProtoNames) {
  if (!isKeyAssignable(name)) {
    continue
  }

  const wrapped = wrapperMap.get(name)

  if (wrapped === void 0) {
    copyProperty(ConsoleProto, SafeProto, name)
  } else {
    const descriptor = Reflect.getOwnPropertyDescriptor(SafeProto, name)!

    Reflect.defineProperty(ConsoleProto, name, {
      configurable: descriptor.configurable === true,
      enumerable: descriptor.enumerable === true,
      value: wrapped,
      writable: descriptor.writable === true || typeof descriptor.set === "function"
    })
  }
}

Reflect.defineProperty(Console, Symbol.hasInstance, {
  value: toExternalFunction((instance: unknown) =>
    Reflect.get(Object(instance) as object, isConsoleSymbol!)
  )
})

let builtinConsole: ConsoleObject | undefined
let builtinMethodMap: Map<unknown, typeof Function.prototype> | undefined

const proxy = new OwnProxy(console, {
  get(console, name, receiver) {
    if (receiver === proxy) {
      receiver = console
    }

    const value = Reflect.get(console, name, receiver)

    if (isUpdatableGet(console, name)) {
      if (builtinConsole === void 0) {
        builtinConsole = createBuiltinConsole()
        builtinMethodMap = createBuiltinMethodMap(builtinConsole)
      }

      const builtinMethod = builtinMethodMap!.get(value)

      if (builtinMethod !== void 0) {
        return builtinMethod
      }
    }

    return value
  },
  getOwnPropertyDescriptor(console, name) {
    const descriptor = Reflect.getOwnPropertyDescriptor(console, name)

    if (isUpdatableDescriptor(descriptor)) {
      if (builtinConsole === void 0) {
        builtinConsole = createBuiltinConsole()
        builtinMethodMap = createBuiltinMethodMap(builtinConsole)
      }

      const builtinMethod = builtinMethodMap!.get(descriptor.value)

      if (builtinMethod !== void 0) {
        descriptor.value = builtinMethod
      }
    }

    return descriptor
  }
})

export default proxy
