import text from "./text-module.txt" with { type: "text" }
import * as namespace from "./text-module.txt" with { type: "text" }
import javascript from "./text-module.mjs"
import rawJavaScript from "./text-module.mjs" with { type: "text" }

export { text, namespace, javascript, rawJavaScript }
export { default as reExported } from "./text-module.txt" with { type: "text" }
export * as reExportedNamespace from "./text-module.txt" with { type: "text" }
