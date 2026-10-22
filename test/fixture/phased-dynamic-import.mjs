// Exports functions rather than evaluating phased calls during module load.
// This allows the test to verify the caller's promise and conversion semantics.
export function source(request, options) {
  return import.source(request, options)
}

export function defer(request, options) {
  return import.defer(request, options)
}
