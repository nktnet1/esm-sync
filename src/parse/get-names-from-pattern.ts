import type { AstNode } from "../types/acorn.js"
import getIdentifiersFromPattern from "./get-identifiers-from-pattern.js"
import shared from "../shared.js"

function init() {
  function getNamesFromPattern(pattern: AstNode | null | undefined): string[] {
    const identifiers = getIdentifiersFromPattern(pattern)
    const result: string[] = []

    for (const { name } of identifiers) {
      result.push(name)
    }

    return result
  }

  return getNamesFromPattern
}

export default shared.inited
  ? shared.module.parseGetNamesFromPattern
  : (shared.module.parseGetNamesFromPattern = init())

export type CachedModule = ReturnType<typeof init>
