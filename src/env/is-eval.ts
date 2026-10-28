import safeProcess, { argv } from "../safe/process.js"

import getFlags from "./get-flags.js"
import isPreloaded from "./is-preloaded.js"
import isPrint from "./is-print.js"
import shared from "../shared.js"

function init() {
  function isEval() {
    if (isPrint()) {
      return true
    }

    if (argv.length !== 1 || !isPreloaded()) {
      return false
    }

    const flags = getFlags()

    return flags.eval || (!flags.interactive && !safeProcess.stdin.isTTY)
  }

  return isEval
}

export default shared.inited ? shared.module.envIsEval : (shared.module.envIsEval = init())

export type CachedModule = ReturnType<typeof init>
