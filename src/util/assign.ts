type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I
) => void
  ? I
  : never
import has from "./has.js"
import shared from "../shared.js"

function init() {
  function assign<T extends object, S extends object[]>(
    object: T,
    ...sources: S
  ): T & UnionToIntersection<S[number]> {
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]

      for (const name in source) {
        if (has(source, name)) {
          ;(object as Record<string, unknown>)[name] = (source as Record<string, unknown>)[name]
        }
      }
    }

    return object as T & UnionToIntersection<S[number]>
  }

  return assign
}

export default shared.inited ? shared.module.utilAssign : (shared.module.utilAssign = init())

export type CachedModule = ReturnType<typeof init>
