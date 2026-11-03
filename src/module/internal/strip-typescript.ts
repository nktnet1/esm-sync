import RealModule from "../../real/module.js"

// Node's type stripper is optional because esm-sync also supports older Node
// releases. It is used only for native erasable TypeScript syntax; the ESM
// compiler remains responsible for linking, evaluation and interop.
const nativeStrip = (
  RealModule as typeof RealModule & {
    stripTypeScriptTypes?: (source: string, options: { mode: "strip"; sourceUrl: string }) => string
  }
).stripTypeScriptTypes

function stripTypeScript(content: string, ext: string | null, filename: string): string {
  if ((ext !== ".ts" && ext !== ".mts" && ext !== ".cts") || typeof nativeStrip !== "function") {
    return content
  }

  return nativeStrip(content, { mode: "strip", sourceUrl: filename })
}

export default stripTypeScript
