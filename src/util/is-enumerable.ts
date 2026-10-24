import shared from "../shared.js"

function init() {
  const { propertyIsEnumerable } = Object.prototype

  function isEnumerable(object: unknown, name: PropertyKey) {
    return object != null && propertyIsEnumerable.call(object, name)
  }

  return isEnumerable
}

export default shared.inited
  ? shared.module.utilIsEnumerable
  : (shared.module.utilIsEnumerable = init())

export type CachedModule = ReturnType<typeof init>
