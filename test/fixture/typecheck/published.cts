import type { Module } from "node:module"
import esm = require("esm-sync")
import esmAlias = require("esm-sync/esm")
import esmJsAlias = require("esm-sync/esm.js")
import indexAlias = require("esm-sync/index")
import indexJsAlias = require("esm-sync/index.js")

declare const mod: Module

const configured = esm(mod, {
  await: true,
  cache: ".cache/esm-sync",
  cjs: {
    cache: true,
    dedefault: false,
    esModule: false,
    extensions: true,
    mutableNamespace: false,
    namedExports: true,
    paths: true,
    topLevelReturn: true,
    vars: true
  },
  debug: false,
  force: false,
  mainFields: ["module", "main"],
  mode: "strict",
  sourceMap: false,
  wasm: false
})

const aliases: Array<typeof configured> = [
  esmAlias(mod),
  esmJsAlias(mod),
  indexAlias(mod),
  indexJsAlias(mod)
]

// @ts-expect-error Public mode remains restricted to three supported strings.
esm(mod, { mode: "unsupported" })
// @ts-expect-error CommonJS option values must be booleans.
indexAlias(mod, { cjs: { cache: "enabled" } })
// @ts-expect-error Main fields must be a string array.
esmJsAlias(mod, { mainFields: "main" })

void aliases
