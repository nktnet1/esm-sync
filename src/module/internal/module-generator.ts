export default function moduleGenerator(value: unknown): Generator<unknown, unknown, unknown> {
  if (typeof value !== "object" || value === null)
    throw new TypeError("Expected a module generator")
  const methods = value as Record<PropertyKey, unknown>
  if (
    typeof methods.next !== "function" ||
    typeof methods.throw !== "function" ||
    typeof methods.return !== "function"
  )
    throw new TypeError("Invalid module generator")
  return value as Generator<unknown, unknown, unknown>
}
