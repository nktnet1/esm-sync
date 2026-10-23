import defer * as self from "./defer-self-evaluation.mjs"

try {
  self.value
} catch (error) {
  globalThis.esmSyncDeferredSelfError = error
}

export const value = 41
export const getDeferredValue = () => self.value
