import { env, execArgv } from "../safe/process.js"

import lastArgMatch from "./last-arg-match.js"
import matches from "../util/matches.js"
import parseCommand from "../util/parse-command.js"
import setDeferred from "../util/set-deferred.js"
import shared from "../shared.js"
import stripQuotes from "../util/strip-quotes.js"

function init() {
  function getFlags() {
    const commandArgs = parseCommand(env.NODE_OPTIONS)

    if (Array.isArray(execArgv)) {
      commandArgs.push(...execArgv)
    }

    const flags = {} as {
      abortOnUncaughtException: boolean
      check: boolean
      esModuleSpecifierResolution: string | null
      eval: boolean
      experimentalJSONModules: boolean
      experimentalPolicy: boolean
      experimentalREPLAwait: boolean
      experimentalWorker: boolean
      exposeInternals: boolean
      inspectBrk: boolean
      interactive: boolean
      pendingDeprecation: boolean
      preserveSymlinks: boolean
      preserveSymlinksMain: boolean
      print: boolean
      type: string | null
      inspect: boolean
      preloadModules: string[]
      addons: boolean
      conditions: string[]
    }

    setDeferred(flags, "abortOnUncaughtException", () =>
      matches(commandArgs, "--abort-on-uncaught-exception")
    )
    setDeferred(flags, "check", () => matches(commandArgs, /^(?:--check|-c)$/))
    setDeferred(flags, "addons", () => {
      let enabled = true
      for (const arg of commandArgs) {
        if (arg === "--addons" || arg === "--no-addons") enabled = arg === "--addons"
      }
      return enabled
    })
    setDeferred(flags, "conditions", () => {
      const result: string[] = []
      for (let i = 0; i < commandArgs.length; i++) {
        const arg = commandArgs[i]!
        const match = /^(?:--conditions|-C)=(.*)$/.exec(arg)
        if (match) result.push(stripQuotes(match[1]))
        else if (arg === "--conditions" || arg === "-C") result.push(stripQuotes(commandArgs[++i]))
      }
      return result
    })
    setDeferred(flags, "esModuleSpecifierResolution", () =>
      lastArgMatch(commandArgs, /^--es-module-specifier-resolution=(.+)$/)
    )
    setDeferred(flags, "eval", () => matches(commandArgs, /^(?:--eval|-e)$/))
    setDeferred(flags, "experimentalJSONModules", () =>
      matches(commandArgs, "--experimental-json-modules")
    )
    setDeferred(flags, "experimentalPolicy", () => matches(commandArgs, "--experimental-policy"))
    setDeferred(flags, "experimentalREPLAwait", () =>
      matches(commandArgs, "--experimental-repl-await")
    )
    setDeferred(flags, "experimentalWorker", () => matches(commandArgs, "--experimental-worker"))
    setDeferred(flags, "exposeInternals", () => matches(commandArgs, /^--expose[-_]internals$/))
    setDeferred(flags, "inspectBrk", () =>
      matches(commandArgs, /^--(?:debug|inspect)-brk(?:=.+)?$/)
    )
    setDeferred(flags, "interactive", () => matches(commandArgs, /^(?:--interactive|-i)$/))
    setDeferred(flags, "pendingDeprecation", () => matches(commandArgs, "--pending-deprecation"))
    setDeferred(
      flags,
      "preserveSymlinks",
      () => matches(commandArgs, "--preserve-symlinks") || env.NODE_PRESERVE_SYMLINKS === "1"
    )
    setDeferred(flags, "preserveSymlinksMain", () =>
      matches(commandArgs, "--preserve-symlinks-main")
    )
    setDeferred(flags, "print", () => matches(commandArgs, /^(?:--print|-pe?)$/))
    setDeferred(flags, "type", () => lastArgMatch(commandArgs, /^--type=(.+)$/))

    setDeferred(flags, "inspect", () => {
      return flags.inspectBrk || matches(commandArgs, /^--(?:debug|inspect)(?:=.*)?$/)
    })

    setDeferred(flags, "preloadModules", () => {
      const flagRegExp = /^(?:--require|-r)$/
      const { length } = commandArgs
      const result: string[] = []

      let i = -1

      while (++i < length) {
        if (flagRegExp.test(commandArgs[i]!)) {
          result.push(stripQuotes(commandArgs[++i]))
        }
      }

      return result
    })

    return flags
  }

  return getFlags
}

export default shared.inited ? shared.module.envGetFlags : (shared.module.envGetFlags = init())

export type CachedModule = ReturnType<typeof init>
