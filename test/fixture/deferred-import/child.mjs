globalThis.deferredModuleEvaluationCount = (globalThis.deferredModuleEvaluationCount ?? 0) + 1
export let value = 42
export { value as then }
