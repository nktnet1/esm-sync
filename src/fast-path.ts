import type { AstNode } from "./types/acorn.js"
import Reflect from "./reflection.js"
// A simplified version of Recast's `FastPath`.
// Copyright Ben Newman. Released under MIT license:
// https://github.com/benjamn/recast

import alwaysTrue from "./util/always-true.js"
import isObject from "./util/is-object.js"
import setPrototypeOf from "./util/set-prototype-of.js"
import shared from "./shared.js"

function init() {
  class FastPath<T = AstNode> {
    stack: unknown[]
    constructor(ast: T) {
      this.stack = [ast]
    }

    // Temporarily push a `key` and its `value` onto `this.stack`, then call the
    // `visitor` method with a reference to `this` (modified) `FastPath` object.
    // Note that the stack is restored to its original state after the `visitor`
    // method has finished, so don't retain a reference to the path.
    call(visitor: object, methodName: string, key: PropertyKey): unknown {
      const { stack } = this
      const object = stack[stack.length - 1]

      if (typeof object !== "object" || object === null) throw new TypeError("Invalid AST path")
      stack.push(key, Reflect.get(object, key))

      const method = Reflect.get(visitor, methodName)
      if (typeof method !== "function") throw new TypeError("Invalid visitor method")
      const result = Reflect.apply(method, visitor, [this])

      stack.length -= 2
      return result
    }

    // Similar to `FastPath.prototype.call()`, except that the value obtained by
    // `this.getValue()` should be array-like. The `visitor` method is called
    // with a reference to this path object for each element of the array.
    each(visitor: object, methodName: string): void {
      const { stack } = this
      const array = stack[stack.length - 1]
      if (!Array.isArray(array)) throw new TypeError("Expected AST array")
      const { length } = array

      let i = -1

      while (++i < length) {
        stack.push(i, array[i])
        const method = Reflect.get(visitor, methodName)
        if (typeof method !== "function") throw new TypeError("Invalid visitor method")
        Reflect.apply(method, visitor, [this])
        stack.length -= 2
      }
    }

    getNode(pos?: number, callback?: (node: AstNode) => boolean | void): AstNode | null {
      const { stack } = this

      let i = stack.length

      if (typeof callback !== "function") {
        callback = alwaysTrue
      }

      if (pos !== void 0) {
        i = pos < 0 ? i + pos : pos
      }

      while (i-- > 0) {
        // Without a complete list of node type names, we have to settle for
        // this fuzzy matching of object shapes.
        const value = stack[i--]

        if (
          isObject(value) &&
          !Array.isArray(value) &&
          typeof value.type === "string" &&
          callback(value as unknown as AstNode)
        ) {
          return value as unknown as AstNode
        }
      }

      return null
    }

    getParentNode(callback?: (node: AstNode) => boolean | void): AstNode | null {
      return this.getNode(-2, callback)
    }

    getValue(): T {
      const { stack } = this

      return stack[stack.length - 1] as T
    }
  }

  setPrototypeOf(FastPath.prototype, null)

  return FastPath
}

export default shared.inited ? shared.module.FastPath : (shared.module.FastPath = init())

export type CachedModule = ReturnType<typeof init>
