import builtinEntries from "../builtin-entries.js"

function hook(global: Record<PropertyKey, unknown>) {
  global.console = builtinEntries.console!.module.exports
  global.process = builtinEntries.process!.module.exports
}

export default hook
