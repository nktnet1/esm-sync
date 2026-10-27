import type { ModuleRecord } from "../../types/runtime.js"
import type { Descriptor } from "../../reflection.js"
import Reflect from "../../reflection.js"
import OwnProxy from "../../own/proxy.js"
import SafeObject from "../../safe/object.js"
import emptyRecord from "../../util/empty-record.js"
import has from "../../util/has.js"
import isObjectLike from "../../util/is-object-like.js"

type Cache = Record<string, ModuleRecord>
interface JestRegistry {
  doMock(name: string, factory: () => unknown, options: { virtual: true }): unknown
  requireActual(name: string): unknown
  requireMock(name: string): unknown
}
interface ScopeIds {
  tokens: WeakMap<object, number>
  caches: WeakMap<object, Cache>
  names: Set<string>
  next: number
}

// Jest exposes a read-only view of its outer require.cache. Put loader-owned
// records in private virtual modules instead: Jest then owns their reset and
// isolateModules lifetimes, without changing how application modules execute.
function createJestCache(externalCache: Cache, namespace = "cjs"): Cache | null {
  let registry: JestRegistry
  let independentScopes: boolean
  try {
    const globals: unknown = __non_webpack_require__("@jest/globals")
    const candidate = isObjectLike(globals) ? Reflect.get(globals, "jest") : null
    if (
      !isObjectLike(candidate) ||
      typeof candidate.doMock !== "function" ||
      typeof candidate.requireActual !== "function" ||
      typeof candidate.requireMock !== "function"
    )
      return null
    registry = candidate as unknown as JestRegistry
    independentScopes = typeof candidate.isolateModulesAsync === "function"
  } catch {
    return null
  }

  const target = emptyRecord<Cache>()
  const scopeKey = Symbol()
  const registered = new Set<string>()
  const prefix =
    "esm-sync/cache/" +
    encodeURIComponent(__non_webpack_module__.filename!) +
    "/" +
    encodeURIComponent(namespace) +
    "/"
  const scopeIds = prefix + "scopes"
  registry.doMock(
    scopeIds,
    (): ScopeIds => ({
      tokens: new WeakMap<object, number>(),
      caches: new WeakMap<object, Cache>(),
      names: new Set<string>(),
      next: 0
    }),
    {
      virtual: true
    }
  )
  const missing = Symbol.for(prefix + "missing")
  const missingFactory = (): Cache => {
    throw missing
  }
  const create = () => emptyRecord<Cache>()
  let generation: unknown

  function scope(name: PropertyKey, writing = false): Cache | null {
    // A non-configurable descriptor must remain on the actual proxy target.
    // Symbol metadata also stays local, as Node's cache is keyed by filenames.
    const fixed = Reflect.getOwnPropertyDescriptor(target, name)
    if (fixed !== void 0 && !fixed.configurable) return target
    const ids = registry.requireMock(scopeIds) as ScopeIds
    const current = registry.requireActual("../package.json")
    // Async-isolation hosts partition real modules strictly. One weak cache
    // per manifest identity avoids registering a virtual module for every file
    // in large ESM graphs. Older Jest also inherits individual outer modules.
    if (independentScopes && isObjectLike(current)) {
      let cache = ids.caches.get(current)
      if (cache === void 0 && writing) {
        cache = emptyRecord<Cache>()
        ids.caches.set(current, cache)
      }
      return cache ?? null
    }
    if (typeof name !== "string") {
      if (current !== generation) {
        for (const key of Reflect.ownKeys(target)) Reflect.deleteProperty(target, key)
        generation = current
      }
      return target
    }

    // Modern Jest isolates real modules even when mocks inherit an outer
    // registry entry. Its manifest identity separates those scopes as well.
    // Keep the identity map in Jest so retained and newly loaded factories
    // agree after resetModules, rather than assigning independent counters.
    let id = isObjectLike(current) ? ids.tokens.get(current) : 0
    if (id === void 0 && isObjectLike(current)) {
      id = ids.next++
      ids.tokens.set(current, id)
    }
    const key = prefix + "modules/" + id + "/" + encodeURIComponent(name)
    if (!registered.has(key)) {
      registry.doMock(key, missingFactory, { virtual: true })
      registered.add(key)
    }
    if (writing) {
      ids.names.add(name)
      registry.doMock(key, create, { virtual: true })
    }
    try {
      const value = registry.requireMock(key)
      if (!isObjectLike(value)) throw new TypeError("Invalid Jest module cache record")
      return value as Cache
    } catch (error) {
      if (error === missing) return null
      throw error
    } finally {
      // A cache read must not populate an empty outer registry entry. In Jest
      // 26 that entry would otherwise be inherited by later isolated callbacks.
      if (writing) registry.doMock(key, missingFactory, { virtual: true })
    }
  }

  function descriptor(name: PropertyKey): Descriptor | undefined {
    const current = scope(name)
    const stored = current === null ? void 0 : Reflect.getOwnPropertyDescriptor(current, name)
    if (stored !== void 0) return stored
    const value = Reflect.get(externalCache, name)
    return value === void 0
      ? void 0
      : { configurable: true, enumerable: true, value, writable: true }
  }

  return new OwnProxy(target, {
    defineProperty(target, name, value) {
      const current = scope(name, true)!
      SafeObject.defineProperty(current, name, value)
      const stored = Reflect.getOwnPropertyDescriptor(current, name)!
      if (current !== target && !stored.configurable) {
        SafeObject.defineProperty(target, name, stored)
      }
      return true
    },
    deleteProperty(_target, name) {
      const current = scope(name)
      return current === null || Reflect.deleteProperty(current, name)
    },
    get(_target, name, receiver) {
      const current = scope(name)
      return current !== null && has(current, name)
        ? Reflect.get(current, name, receiver)
        : Reflect.get(externalCache, name)
    },
    getOwnPropertyDescriptor(_target, name) {
      return descriptor(name)
    },
    has(_target, name) {
      return descriptor(name) !== void 0
    },
    ownKeys(target) {
      const current = independentScopes ? scope(scopeKey) : null
      // Keep the filename index in Jest too, so newly loaded factories and
      // retained cache views enumerate entries written through either view.
      const names = independentScopes ? [] : (registry.requireMock(scopeIds) as ScopeIds).names
      return Array.from(
        new Set([
          ...Reflect.ownKeys(target),
          ...Reflect.ownKeys(externalCache),
          ...(current === null ? [] : Reflect.ownKeys(current)),
          ...names
        ])
      ).filter((name) => descriptor(name) !== void 0)
    },
    set(_target, name, value, receiver) {
      return Reflect.set(scope(name, true)!, name, value, receiver)
    }
  })
}

export default createJestCache
