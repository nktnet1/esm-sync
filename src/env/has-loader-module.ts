import isOwnPath from "../util/is-own-path.js"
import matches from "../util/matches.js"
import shared from "../shared.js"

function init() {
  function hasLoaderModule(modules: readonly { filename?: string | null }[]) {
    return matches(modules, ({ filename }: { filename?: string | null }) => isOwnPath(filename))
  }

  return hasLoaderModule
}

export default shared.inited
  ? shared.module.envHasLoaderModule
  : (shared.module.envHasLoaderModule = init())

export type CachedModule = ReturnType<typeof init>
