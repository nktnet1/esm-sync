import Reflect from "../reflection.js"
// An ordinary property read must retain the receiver and propagate getter errors.
export default function readProperty(value: unknown, key: PropertyKey): unknown {
  if (value === null || value === undefined)
    throw new TypeError("Cannot read properties of " + value)
  return Reflect.get(Object(value) as object, key, value) as unknown
}
