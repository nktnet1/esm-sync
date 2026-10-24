import shared from "../shared.js"

// Await and SafePerformPromiseAll use PerformPromiseThen, rather than looking
// up a user-modifiable .then property on an intrinsic Promise.
const then = shared.external.Promise.prototype.then
const { Promise: NativePromise } = shared.external
const resolve = NativePromise.resolve
const reject = NativePromise.reject

function promiseThen(promise, fulfilled, rejected) {
  return Reflect.apply(then, promise, [fulfilled, rejected])
}

function promiseResolve(value) {
  return Reflect.apply(resolve, NativePromise, [value])
}

function promiseReject(error) {
  return Reflect.apply(reject, NativePromise, [error])
}

export { promiseResolve, promiseReject }

export default promiseThen
