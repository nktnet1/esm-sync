import { createRequire } from "node:module"

// Rspack test entry points normally receive these from esm.js. Expose only
// their runtime globals in Vitest; do not install the native loader hooks.
Object.assign(globalThis, {
  __global__: globalThis,
  __non_webpack_require__: createRequire(import.meta.url)
})
