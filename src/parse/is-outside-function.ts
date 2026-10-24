import type { AstNode } from "../types/acorn.js"
import type FastPath from "../fast-path.js"
type AstPath = InstanceType<typeof FastPath<AstNode>>
import shared from "../shared.js"

function init() {
  function isOutsideFunction(
    path: AstPath,
    name: string,
    map: Map<AstNode, Map<string, boolean>>
  ): boolean {
    let result = false

    path.getParentNode((parent) => {
      const { type } = parent

      let cache = map.get(parent)

      if (cache === void 0) {
        cache = new Map()
        map.set(parent, cache)
      }

      let cached = cache.get(name)

      if (cached !== void 0) {
        return (result = cached)
      }

      if (type === "Program") {
        result = true
        cache.set(name, result)

        return true
      }

      cache.set(name, false)

      if (
        type === "ArrowFunctionExpression" ||
        type === "FunctionDeclaration" ||
        type === "FunctionExpression"
      ) {
        return true
      }
    })

    return result
  }

  return isOutsideFunction
}

export default shared.inited
  ? shared.module.parseIsOutsideFunction
  : (shared.module.parseIsOutsideFunction = init())

export type CachedModule = ReturnType<typeof init>
