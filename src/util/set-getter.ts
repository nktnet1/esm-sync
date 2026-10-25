const { __defineGetter__ } = Object.prototype

function setGetter<T extends object>(object: T, name: PropertyKey, getter: (this: T) => unknown) {
  __defineGetter__.call(object, name, getter)
  return object
}

export default setGetter
