globalThis.deferredModuleFailureCount = (globalThis.deferredModuleFailureCount ?? 0) + 1
throw new Error("deferred failure")
export const value = 1
