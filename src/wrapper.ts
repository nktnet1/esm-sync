type OpaqueFunction = (this: never, ...args: never[]) => unknown
type WrapperMap = { raw: OpaqueFunction; versions: string[]; wrappers: Map<string, OpaqueFunction> }
type WrapperStore = Map<PropertyKey, WrapperMap>
import Reflect from "./reflection.js"
// This module is important for `esm` versioning support and should be changed
// as little as possible. Please ensure any changes are backwards compatible.

import ESM from "./constant/esm.js"

import GenericArray from "./generic/array.js"

import has from "./util/has.js"
import maxSatisfying from "./util/max-satisfying.js"
import proxyWrap from "./util/proxy-wrap.js"
import setSilent from "./util/set-silent.js"
import shared from "./shared.js"
import silent from "./util/silent.js"
import toExternalFunction from "./util/to-external-function.js"

function init() {
  const { PACKAGE_RANGE } = ESM

  const Wrapper = {
    find(object: object, name: PropertyKey, range: string) {
      const map = getMap(object, name)

      if (map !== null) {
        const maxVersion = maxSatisfying(map.versions, range)

        if (maxVersion !== null) {
          const wrapper = map.wrappers.get(maxVersion)

          if (wrapper !== void 0) {
            return wrapper
          }
        }
      }

      return null
    },
    manage(object: object, name: PropertyKey, wrapper: OpaqueFunction) {
      const func = Wrapper.unwrap(object, name)

      const manager: OpaqueFunction = proxyWrap(
        func,
        function (this: unknown, func: OpaqueFunction, args: unknown[]) {
          const newTarget = new.target

          return newTarget === void 0
            ? Reflect.apply(wrapper, this, [manager, func, args])
            : Reflect.construct(wrapper, [manager, func, args], newTarget)
        }
      )

      Reflect.defineProperty(manager, shared.symbol.wrapper, {
        configurable: true,
        value: func
      })

      setSilent(object, name, manager)
    },
    unwrap(object: object, name: PropertyKey) {
      const manager = silent(() => Reflect.get(object, name)) as OpaqueFunction
      const symbol = shared.symbol.wrapper

      return has(manager, symbol) ? (Reflect.get(manager, symbol) as OpaqueFunction) : manager
    },
    wrap(object: object, name: PropertyKey, wrapper: OpaqueFunction) {
      const map = getOrCreateMap(object, name)

      if (map.wrappers.get(PACKAGE_RANGE) === void 0) {
        GenericArray.push(map.versions, PACKAGE_RANGE)
        map.wrappers.set(PACKAGE_RANGE, toExternalFunction(wrapper))
      }
    }
  }

  function createMap(object: object, name: PropertyKey) {
    // Store the wrapper map as `object[shared.symbol.wrapper][name]` rather
    // than on the function so other code can modify the same property without
    // interfering with our wrapper.
    const store = getOrCreateStore(object)

    const map: WrapperMap = {
      raw: Wrapper.unwrap(object, name),
      versions: [],
      wrappers: new Map()
    }

    store.set(name, map)

    return map
  }

  function createStore(object: object) {
    const value: WrapperStore = new Map()

    Reflect.defineProperty(object, shared.symbol.wrapper, {
      configurable: true,
      value
    })

    return value
  }

  function getMap(object: object, name: PropertyKey) {
    const store = getStore(object)

    let map: WrapperMap | undefined

    if (store !== null) {
      map = store.get(name)
    }

    return map === void 0 ? null : map
  }

  function getOrCreateMap(object: object, name: PropertyKey) {
    const map = getMap(object, name)

    return map === null ? createMap(object, name) : map
  }

  function getOrCreateStore(object: object) {
    const store = getStore(object)

    return store === null ? createStore(object) : store
  }

  function getStore(object: object) {
    const symbol = shared.symbol.wrapper

    return has(object, symbol) ? (Reflect.get(object, symbol) as WrapperStore) : null
  }

  return Wrapper
}

export default shared.inited ? shared.module.Wrapper : (shared.module.Wrapper = init())

export type CachedModule = ReturnType<typeof init>
