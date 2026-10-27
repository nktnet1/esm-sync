import type { ModuleRecord } from "./types/runtime.js"
import emptyRecord from "./util/empty-record.js"
import ENV from "./constant/env.js"

import Module from "./module.js"
import Package from "./package.js"
import RealModule from "./real/module.js"
import createJestCache from "./module/internal/jest-cache.js"

import esmExtensions from "./module/esm/extensions.js"
import realProcess from "./real/process.js"
import setDeferred from "./util/set-deferred.js"
import setPrototypeOf from "./util/set-prototype-of.js"
import shared from "./shared.js"

const { FLAGS } = ENV

// biome-ignore lint/complexity/noStaticOnlyClass: Preserve the constructor and prototype identity used by loader hooks.
class Loader {
  declare static state: import("./types/runtime.js").LoaderState

  static init(cacheKey: unknown) {
    const { loader } = shared

    let cached = loader.get(cacheKey)

    if (cached === void 0) {
      // Keep ESM namespaces and linking records in the same Jest scope as
      // their CommonJS dependencies, including when a require is retained.
      const createCache = (kind: string) => {
        const cache = emptyRecord<Record<string, ModuleRecord>>()
        return typeof cacheKey === "string" && Module._cache !== RealModule._cache
          ? (createJestCache(cache, "loader/" + kind + "/" + cacheKey) ?? cache)
          : cache
      }
      cached = {
        module: {
          breakFirstLine: FLAGS.inspectBrk && !FLAGS.eval,
          extensions: esmExtensions,
          globalPaths: Array.from(Module.globalPaths),
          mainModule: realProcess.mainModule,
          moduleCache: createCache("modules"),
          scratchCache: createCache("linking")
        },
        package: {
          cache: new Map(),
          default: null
        }
      }

      loader.set(cacheKey, cached!)
    }

    return (Loader.state = cached!)
  }
}

setDeferred(Loader, "state", () => Loader.init(JSON.stringify(Package.createOptions())))

setPrototypeOf(Loader.prototype, null)

export default Loader
