import shared from "../../shared.js"
import promiseThen, { promiseResolve, promiseReject } from "../../util/promise-then.js"
import { makeAwait } from "./sync-await.js"

const { Promise: NativePromise, TypeError: NativeTypeError, Error: NativeError } = shared.external
const NativeSuppressedError = shared.unsafeGlobal.SuppressedError
const apply = Reflect.apply
const asyncIteratorSymbol = Symbol.asyncIterator
const iteratorSymbol = Symbol.iterator
// Node 22 installs these aliases on its main global, but not in the loader's
// separate V8 realm. Later runtimes expose standard well-known symbols there.
const asyncDisposeSymbol = Symbol.asyncDispose || Symbol.for("nodejs.asyncDispose")
const disposeSymbol = Symbol.dispose || Symbol.for("nodejs.dispose")

function object(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    throw new NativeTypeError("Iterator result or resource must be an object")
  }
  return value
}

function method(value, key) {
  const result = value[key]
  if (result == null) return void 0
  if (typeof result !== "function")
    throw new NativeTypeError("Iterator or dispose method is not callable")
  return result
}

// Capture next once, as GetIterator does. Async iterators retain their value
// unchanged; only AsyncFromSyncIterator unwraps a synchronous iterator's value.
function asyncIterator(value) {
  if (value == null) throw new NativeTypeError("Value is not async iterable")
  let get = method(value, asyncIteratorSymbol)
  const sync = get === void 0
  if (sync) get = method(value, iteratorSymbol)
  if (get === void 0) throw new NativeTypeError("Value is not async iterable")
  const iterator = object(apply(get, value, []))
  const next = iterator.next

  function fromSync(result, closeOnRejection) {
    object(result)
    const done = Boolean(result.done)
    const value = result.value
    return promiseThen(
      promiseResolve(value),
      (value) => ({ done, value }),
      (error) => {
        // AsyncFromSyncIteratorContinuation closes a sync generator when its
        // yielded promise rejects, but preserves that rejection over return().
        if (!done && closeOnRejection) {
          try {
            const close = method(iterator, "return")
            if (close !== void 0) object(apply(close, iterator, []))
          } catch {}
        }
        throw error
      }
    )
  }

  return {
    next() {
      if (!sync) return apply(next, iterator, [])
      // Async-from-sync next errors are promise rejections, not synchronous
      // throws. Do not close for errors in next/done/value themselves.
      try {
        return fromSync(apply(next, iterator, []), true)
      } catch (error) {
        return promiseReject(error)
      }
    },
    *close() {
      if (sync) {
        let result
        try {
          const close = method(iterator, "return")
          result =
            close === void 0
              ? { done: true, value: void 0 }
              : fromSync(apply(close, iterator, []), false)
        } catch (error) {
          result = promiseReject(error)
        }
        object(yield makeAwait(result))
        return
      }
      const close = method(iterator, "return")
      if (close !== void 0) object(yield makeAwait(apply(close, iterator, [])))
    },
    value(result) {
      return object(result).value
    },
    done(result) {
      return Boolean(object(result).done)
    }
  }
}

function suppressed(error, previous) {
  if (typeof NativeSuppressedError === "function") return new NativeSuppressedError(error, previous)
  // Older supported runtimes have disposal symbols but no SuppressedError.
  const result = new NativeError()
  Object.defineProperties(result, {
    name: { configurable: true, writable: true, value: "SuppressedError" },
    error: { configurable: true, writable: true, value: error },
    suppressed: { configurable: true, writable: true, value: previous }
  })
  return result
}

class Resources {
  constructor() {
    this.stack = []
    this.failed = false
    this.error = void 0
  }

  add(value, async) {
    let dispose
    let fallback = false
    if (value != null) {
      object(value)
      if (async) dispose = method(value, asyncDisposeSymbol)
      if (dispose === void 0) {
        dispose = method(value, disposeSymbol)
        fallback = async
      }
      if (dispose === void 0) throw new NativeTypeError("Resource is not disposable")
    } else if (!async) return value
    this.stack.push({ value, dispose, async, fallback })
    return value
  }

  fail(error) {
    this.failed = true
    this.error = error
  }

  *dispose() {
    let needsAwait = false
    let hasAwaited = false
    while (this.stack.length !== 0) {
      const resource = this.stack.pop()
      if (!resource.async && needsAwait && !hasAwaited) {
        yield makeAwait(void 0)
        needsAwait = false
      }
      if (resource.dispose === void 0) {
        needsAwait = true
        continue
      }
      try {
        let result
        if (resource.fallback) {
          // The async wrapper of @@dispose ignores its return value, including
          // promises/thenables, and turns synchronous throws into rejections.
          result = new NativePromise((resolve, reject) => {
            try {
              apply(resource.dispose, resource.value, [])
              resolve()
            } catch (error) {
              reject(error)
            }
          })
        } else result = apply(resource.dispose, resource.value, [])
        if (resource.async) {
          try {
            yield makeAwait(result)
          } finally {
            hasAwaited = true
          }
        }
      } catch (error) {
        this.error = this.failed ? suppressed(error, this.error) : error
        this.failed = true
      }
    }
    if (needsAwait && !hasAwaited) yield makeAwait(void 0)
    if (this.failed) throw this.error
  }
}

function resources() {
  return new Resources()
}

export { asyncIterator, resources }
