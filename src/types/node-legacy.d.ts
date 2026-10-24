import "node:vm"
import "node:repl"
import type { ModuleRecord } from "./runtime.js"
declare module "node:vm" {
  export function createScript(code: string, options?: string | ScriptOptions): Script
}
declare module "node:repl" {
  interface REPLServer {
    createContext(): import("node:vm").Context & { module: ModuleRecord }
  }
}
