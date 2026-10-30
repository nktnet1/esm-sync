import { REPLServer } from "../safe/repl.js"
import realVM from "../real/vm.js"
import toExternalFunction from "../util/to-external-function.js"
import vmHook from "./vm.js"

// An application's `repl.start()` is not the initial `node -i` REPL. Defer
// the VM/REPL hooks until the application actually creates a REPL context.
function hook() {
  const { createContext } = REPLServer.prototype
  if (typeof createContext !== "function") return

  REPLServer.prototype.createContext = toExternalFunction(function (
    this: import("node:repl").REPLServer
  ) {
    REPLServer.prototype.createContext = createContext
    vmHook(realVM, true)
    return REPLServer.prototype.createContext.call(this)
  })
}

export default hook
