import { Module } from "node:module"
import makeRequire from "esm-sync"
import esmAlias from "esm-sync/esm"
import esmJsAlias from "esm-sync/esm.js"
import indexAlias from "esm-sync/index"
import indexJsAlias from "esm-sync/index.js"

const parent = new Module("published-esm-consumer.mjs")
const configured = makeRequire(parent, { mode: "auto", await: true, cache: false })
const aliases: Array<typeof makeRequire> = [esmAlias, esmJsAlias, indexAlias, indexJsAlias]

// @ts-expect-error Unknown public options must be rejected for ESM consumers.
makeRequire(parent, { unsupported: true })
// @ts-expect-error The published mode option is a restricted union.
indexJsAlias(parent, { mode: "other" })

void configured
void aliases
