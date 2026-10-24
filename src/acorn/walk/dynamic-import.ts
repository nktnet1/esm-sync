// Based on acorn-dynamic-import.
// Copyright Jordan Gensler. Released under MIT license:
// https://github.com/kesne/acorn-dynamic-import

import noop from "../../util/noop.js"
import shared from "../../shared.js"

function init() {
  const Plugin = {
    enable(walk: Record<PropertyKey, unknown>) {
      const base = walk.base
      if (typeof base === "object" && base !== null) (base as Record<string, unknown>).Import = noop

      return walk
    }
  }

  return Plugin
}

export default shared.inited
  ? shared.module.acornWalkDynamicImport
  : (shared.module.acornWalkDynamicImport = init())

export type CachedModule = ReturnType<typeof init>
