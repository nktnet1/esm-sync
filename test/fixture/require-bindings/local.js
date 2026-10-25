import { createRequire } from "node:module"

export let beforeInitialization
try {
  beforeInitialization = typeof require
} catch (error) {
  beforeInitialization = error.name
}

export const require = createRequire ? createRequire(import.meta.url) : undefined
export const exports = "module scope"
export const shorthand = { require }
export const mixin = { require: (request) => require(request) }

export function shadowed(require) {
  const object = { require }
  return object.require
}

export default require
