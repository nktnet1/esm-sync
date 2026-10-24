import Reflect from "../reflection.js"
import shared from "../shared.js"

// Await and SafePerformPromiseAll use PerformPromiseThen, rather than looking
// up a user-modifiable .then property on an intrinsic Promise.
const then = shared.external.Promise.prototype.then
const { Promise: NativePromise } = shared.external
const resolve = NativePromise.resolve
const reject = NativePromise.reject

function promiseThen<T, U = T, V = never>(
  promise: Promise<T>,
  fulfilled?: ((value: T) => U | PromiseLike<U>) | undefined,
  rejected?: ((error: unknown) => V | PromiseLike<V>) | undefined
): Promise<U | V> {
  return Reflect.apply(then, promise, [fulfilled, rejected]) as Promise<U | V>
}

function promiseResolve<T = void>(value?: T): Promise<Awaited<T>> {
  return Reflect.apply(resolve, NativePromise, [value]) as Promise<Awaited<T>>
}

function promiseReject(error: unknown): Promise<never> {
  return Reflect.apply(reject, NativePromise, [error]) as Promise<never>
}

export { promiseResolve, promiseReject }

export default promiseThen
