const { __defineSetter__ } = Object.prototype

function setSetter<T extends object>(
  object: T,
  name: PropertyKey,
  setter: (this: T, value: unknown) => void
) {
  __defineSetter__.call(object, name, setter)
  return object
}

export default setSetter
