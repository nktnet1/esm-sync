import inspect from "./inspect.js"

function inspectTrunc(value: unknown, limit = 128) {
  const inspected = inspect(value)

  return inspected.length > limit ? inspected.slice(0, limit) + "..." : inspected
}

export default inspectTrunc
