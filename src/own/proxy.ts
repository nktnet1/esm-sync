export type StrictProxyHandler<T extends object> = Omit<
  ProxyHandler<T>,
  "get" | "set" | "apply" | "construct" | "getOwnPropertyDescriptor" | "defineProperty"
> & {
  get?: (target: T, key: PropertyKey, receiver?: unknown) => unknown
  set?: (target: T, key: PropertyKey, value: unknown, receiver?: unknown) => boolean
  apply?: (target: T, thisArg: unknown, args: unknown[]) => unknown
  construct?: (target: T, args: unknown[], newTarget: typeof Function.prototype) => unknown
  getOwnPropertyDescriptor?: (
    target: T,
    key: PropertyKey
  ) => import("../reflection.js").Descriptor | undefined
  defineProperty?: (
    target: T,
    key: PropertyKey,
    descriptor: import("../reflection.js").Descriptor
  ) => boolean
}
export type NullableProxyHandler<T extends object> = {
  [K in keyof StrictProxyHandler<T>]: StrictProxyHandler<T>[K] | null
}
export type ProxyDetails = [object, NullableProxyHandler<object>]
interface OwnProxyConstructor {
  new <T extends object>(target: T, handler: NullableProxyHandler<T>): T
  instances: WeakMap<object, ProxyDetails>
}
import Reflect from "../reflection.js"
import setPrototypeOf from "../util/set-prototype-of.js"
import shared from "../shared.js"
import toExternalFunction from "../util/to-external-function.js"

function init(): OwnProxyConstructor {
  const customInspectDescriptor = {
    value: toExternalFunction(() => "{}")
  }

  const markerDescriptor = {
    value: 1
  }

  class OwnProxy {
    static instances = new WeakMap<object, ProxyDetails>()

    constructor(target: object, handler: NullableProxyHandler<object>) {
      const maskedHandler = { __proto__: handler } as NullableProxyHandler<object>
      const proxy = new Proxy(target, maskedHandler as ProxyHandler<object>)

      setPrototypeOf(handler, null)

      for (const name in handler) {
        toExternalFunction(Reflect.get(handler, name))
      }

      Reflect.defineProperty(
        maskedHandler,
        shared.customInspectKey as PropertyKey,
        customInspectDescriptor
      )
      Reflect.defineProperty(maskedHandler, shared.symbol.proxy, markerDescriptor)

      OwnProxy.instances.set(proxy, [target, maskedHandler])

      // Wrap `proxy` in a decoy proxy so that `proxy` will be used as the
      // unwrapped inspectable value.
      const emptyHandler = {}
      const decoyProxy = new Proxy(proxy, emptyHandler)

      OwnProxy.instances.set(decoyProxy, [proxy, emptyHandler])

      return decoyProxy
    }
  }

  setPrototypeOf(OwnProxy.prototype, null)

  return OwnProxy as unknown as OwnProxyConstructor
}

export default shared.inited ? shared.module.OwnProxy : (shared.module.OwnProxy = init())

export type CachedModule = ReturnType<typeof init>
