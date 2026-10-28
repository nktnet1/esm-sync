import type { Program } from "../../types/acorn.js"
import Parser from "../../parser.js"
import shared from "../../shared.js"

function init() {
  const records = new WeakMap<object, Program>()
  const fixtures = new Map<string, string>()
  const { TypeError: ExTypeError, Object: ExObject, Function: ExFunction } = shared.external

  class AbstractModuleSource {
    constructor() {
      throw new ExTypeError("AbstractModuleSource is not constructible")
    }
    get [Symbol.toStringTag]() {
      return records.has(this) ? "ModuleSource" : void 0
    }
  }
  class ModuleSource extends AbstractModuleSource {}
  Object.setPrototypeOf(AbstractModuleSource, ExFunction.prototype)
  Object.setPrototypeOf(AbstractModuleSource.prototype, ExObject.prototype)

  return {
    AbstractModuleSource,
    fixtures,
    create(source: string): object {
      // Parse without the execution compiler's deliberate error tolerance.
      // Source imports must never resolve dependencies or execute the body.
      const record = Parser.parse(source, { sourceType: "module", tolerant: false })
      const value = Object.create(ModuleSource.prototype) as object
      records.set(value, record)
      return value
    }
  }
}

export default shared.inited
  ? shared.module.esmModuleSource
  : (shared.module.esmModuleSource = init())

export type CachedModule = ReturnType<typeof init>
