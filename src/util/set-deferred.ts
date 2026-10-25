import Reflect from "../reflection.js"
import setGetter from "./set-getter.js"
import setSetter from "./set-setter.js"

const dataDescriptor = {
  configurable: true,
  enumerable: true,
  value: void 0 as unknown,
  writable: true
}

const emptyArray: [] = []

function setDeferred<T extends object, K extends PropertyKey>(
  object: T,
  name: K,
  getter: (this: T) => unknown
): T {
  setGetter(object, name, function () {
    ;(this as Record<PropertyKey, unknown>)[name] = void 0

    return ((this as Record<PropertyKey, unknown>)[name] = Reflect.apply(getter, this, emptyArray))
  })

  setSetter(object, name, function (value) {
    dataDescriptor.value = value
    Reflect.defineProperty(this, name, dataDescriptor)
  })

  return object
}

export default setDeferred
