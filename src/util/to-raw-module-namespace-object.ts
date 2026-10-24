import Reflect from "../reflection.js"
import emptyRecord from "./empty-record.js"
import assign from "./assign.js"
import shared from "../shared.js"

function init() {
  const toStringTagDescriptor = {
    value: "Module"
  }

  function toRawModuleNamespaceObject(
    object: Record<string, unknown> = {}
  ): Record<string, unknown> {
    // Section 9.4.6: Module Namespace Exotic Objects
    // Module namespace objects have a `null` [[Prototype]].
    // https://tc39.github.io/ecma262/#sec-module-namespace-exotic-objects
    const namespace = emptyRecord<Record<string, unknown>>()

    // Section 26.3.1: @@toStringTag
    // Module namespace objects have a @@toStringTag value of "Module".
    // https://tc39.github.io/ecma262/#sec-@@tostringtag
    Reflect.defineProperty(namespace, Symbol.toStringTag, toStringTagDescriptor)

    return assign(namespace, object)
  }

  return toRawModuleNamespaceObject
}

export default shared.inited
  ? shared.module.utilToRawModuleNamespaceObject
  : (shared.module.utilToRawModuleNamespaceObject = init())

export type CachedModule = ReturnType<typeof init>
