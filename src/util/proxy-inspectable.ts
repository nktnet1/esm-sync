type InspectOptions = import("node:util").InspectOptions
import Reflect from "../reflection.js"
import { inspect as safeInspect } from "../safe/util.js"

import GenericFunction from "../generic/function.js"
import GenericObject from "../generic/object.js"
import OwnProxy from "../own/proxy.js"

import assign from "./assign.js"
import builtinInspect from "../builtin/inspect.js"
import getProxyDetails from "./get-proxy-details.js"
import isModuleNamespaceObject from "./is-module-namespace-object.js"
import isObjectLike from "./is-object-like.js"
import isOwnProxy from "./is-own-proxy.js"
import isProxy from "./is-proxy.js"
import isProxyInspectable from "./is-proxy-inspectable.js"
import isUpdatableDescriptor from "./is-updatable-descriptor.js"
import isUpdatableGet from "./is-updatable-get.js"
import ownPropertyNames from "./own-property-names.js"
import prepareValue from "./prepare-value.js"
import shared from "../shared.js"
import toExternalFunction from "./to-external-function.js"
import toRawModuleNamespaceObject from "./to-raw-module-namespace-object.js"

const UNINITIALIZED_BINDING = "<uninitialized>"
const UNINITIALIZED_VALUE = {}

const nonWhitespaceRegExp = /\S/

function proxyInspectable<T>(
  object: T,
  options: InspectOptions,
  map?: Map<object, object>
): unknown {
  if (!isProxyInspectable(object) || !isObjectLike(object)) {
    return object
  }

  if (map === void 0) {
    map = new Map()
  } else {
    const cached = map.get(object)

    if (cached !== void 0) {
      return cached
    }
  }

  let objectIsProxy: boolean | undefined
  let objectIsOwnProxy: boolean | undefined
  let inspecting = false

  const proxy = new OwnProxy(object, {
    get(object, name, receiver) {
      if (receiver === proxy) {
        receiver = object
      }

      const { customInspectKey } = shared
      const value: unknown = Reflect.get(object, name, receiver)

      let newValue = value

      if (value === builtinInspect && (name === customInspectKey || name === "inspect")) {
        newValue = safeInspect
      } else if (inspecting || name !== customInspectKey) {
        if (name === "toString" && typeof value === "function") {
          newValue = GenericFunction.bind(value, object)
        }
      } else {
        newValue = toExternalFunction((...args: unknown[]) => {
          inspecting = true

          let [recurseTimes, context] = args

          const contextAsOptions = assign(
            GenericObject.create(),
            context as object
          ) as InspectOptions
          const { showProxy } = options

          contextAsOptions.customInspect = options.customInspect
          contextAsOptions.depth = recurseTimes as number | null
          contextAsOptions.showProxy = showProxy

          try {
            if (object === UNINITIALIZED_VALUE) {
              return contextAsOptions.colors
                ? stylize(UNINITIALIZED_BINDING, "special")
                : UNINITIALIZED_BINDING
            }

            if (isModuleNamespaceObject(object)) {
              return formatNamespaceObject(object, contextAsOptions)
            }

            if (objectIsOwnProxy === void 0) {
              objectIsOwnProxy = isOwnProxy(object)
            }

            if (objectIsProxy === void 0) {
              objectIsProxy = isProxy(object)
            }

            if (!showProxy || !objectIsProxy || objectIsOwnProxy) {
              if (typeof value !== "function") {
                contextAsOptions.customInspect = true
              }

              contextAsOptions.showProxy = false

              return safeInspect(proxy, contextAsOptions)
            }

            return formatProxy(object, contextAsOptions)
          } finally {
            inspecting = false
          }
        })
      }

      if (newValue !== value && isUpdatableGet(object, name)) {
        return newValue
      }

      return prepareValue(value)
    },
    getOwnPropertyDescriptor(object, name) {
      const descriptor = Reflect.getOwnPropertyDescriptor(object, name)

      if (isUpdatableDescriptor(descriptor)) {
        const { value } = descriptor

        if (isObjectLike(value)) {
          descriptor.value = proxyInspectable(value, options, map)
        }
      }

      return descriptor
    }
  })

  map.set(object, proxy)
  map.set(proxy, proxy)

  return proxy
}

function formatNamespaceObject(namespace: object, context: InspectOptions): string {
  // Avoid `Object.keys()` because it calls `[[GetOwnProperty]]()`,
  // which calls `[[Get]]()`, which calls `GetBindingValue()`,
  // which throws for uninitialized bindings.
  //
  // Section 8.1.1.5.1: GetBindingValue()
  // Step 5: Throw a reference error if the binding is uninitialized.
  // https://tc39.github.io/ecma262/#sec-module-environment-records-getbindingvalue-n-s
  const names = ownPropertyNames(namespace)
  const object = toRawModuleNamespaceObject()

  for (const name of names) {
    object[name] = tryGet(namespace, name)
  }

  const result = builtinInspect(object, context)
  const indentation = result.slice(0, result.search(nonWhitespaceRegExp))
  const trimmed = result.slice(result.indexOf("{"), result.lastIndexOf("}") + 1)

  return indentation + "[Module] " + trimmed
}

function formatProxy(proxy: object, context: InspectOptions): string {
  const details = getProxyDetails(proxy)

  let object = proxy

  if (details !== void 0) {
    object = new Proxy(
      toInspectable(details[0], context),
      toInspectable(details[1], context) as ProxyHandler<object>
    )
  }

  const contextAsOptions = assign({}, context)

  contextAsOptions.customInspect = true

  return safeInspect(object, contextAsOptions)
}

function stylize(string: string, styleType: keyof typeof builtinInspect.styles): string {
  const style = builtinInspect.styles[styleType]

  if (style === void 0) {
    return string
  }

  const [foregroundCode, backgroundCode] =
    builtinInspect.colors[style as keyof typeof builtinInspect.colors]!

  return "\u001B[" + foregroundCode + "m" + string + "\u001B[" + backgroundCode + "m"
}

function toInspectable(value: unknown, options: InspectOptions) {
  return {
    __proto__: null,
    [shared.customInspectKey!]: toExternalFunction((recurseTimes: number | null) => {
      const contextAsOptions = assign(GenericObject.create(), options)

      contextAsOptions.depth = recurseTimes as number | null

      return builtinInspect(value, contextAsOptions)
    })
  }
}

function tryGet(object: object, name: PropertyKey): unknown {
  try {
    return Reflect.get(object, name)
  } catch {}

  return UNINITIALIZED_VALUE
}

export default proxyInspectable
