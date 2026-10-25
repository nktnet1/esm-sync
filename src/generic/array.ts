interface GenericArrayAPI {
  concat<T>(array: readonly T[], ...values: (T | readonly T[])[]): T[]
  from<T>(array: Iterable<T, unknown, unknown> | ArrayLike<T>): T[]
  from<T, U>(
    array: Iterable<T, unknown, unknown> | ArrayLike<T>,
    map: (value: T, index: number) => U
  ): U[]
  indexOf<T>(array: readonly T[], value: T, fromIndex?: number): number
  join(array: readonly unknown[], separator?: string): string
  of<T>(...items: T[]): T[]
  push<T>(array: T[], ...items: T[]): number
  unshift<T>(array: T[], ...items: T[]): number
}
import SafeArray from "../safe/array.js"

import shared from "../shared.js"
import unapply from "../util/unapply.js"

function init(): GenericArrayAPI {
  const ArrayProto: unknown[] = Array.prototype
  const SafeProto: unknown[] = SafeArray.prototype

  return {
    concat: unapply(SafeProto.concat) as GenericArrayAPI["concat"],
    from: SafeArray.from,
    indexOf: unapply(ArrayProto.indexOf),
    join: unapply(ArrayProto.join),
    of: SafeArray.of,
    push: unapply(ArrayProto.push),
    unshift: unapply(ArrayProto.unshift)
  }
}

export default shared.inited ? shared.module.GenericArray : (shared.module.GenericArray = init())

export type CachedModule = ReturnType<typeof init>
