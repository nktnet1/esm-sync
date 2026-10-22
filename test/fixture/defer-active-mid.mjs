import defer * as leaf from "./defer-active-leaf.mjs"

try {
  leaf.value
} catch (error) {
  globalThis.esmSyncDeferredDependencyError = error
}
