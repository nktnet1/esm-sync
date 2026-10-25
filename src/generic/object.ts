import shared from "../shared.js"
import isObjectLike from "../util/is-object-like.js"

function init() {
  const ExObject = shared.external.Object

  return {
    create(
      proto?: unknown,
      properties?: PropertyDescriptorMap | null
    ): Record<PropertyKey, unknown> {
      if (properties === null) {
        properties = void 0
      }

      if (proto === null || isObjectLike(proto)) {
        return (
          properties === undefined ? Object.create(proto) : Object.create(proto, properties)
        ) as Record<PropertyKey, unknown>
      }

      return properties === void 0
        ? (new ExObject() as Record<PropertyKey, unknown>)
        : Object.defineProperties(new ExObject() as Record<PropertyKey, unknown>, properties)
    }
  }
}

export default shared.inited ? shared.module.GenericObject : (shared.module.GenericObject = init())

export type CachedModule = ReturnType<typeof init>
