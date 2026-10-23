import defer * as dependency from "./deferred-body.mjs"

export const events = globalThis.__packedDeferredEvents
export { dependency }
export function read() {
  return dependency.value
}
export function later() {
  return import.defer("./deferred-body.mjs")
}
