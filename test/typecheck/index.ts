import type { Module } from "node:module"

import esm = require("../../index")
import publicEntry = require("esm-sync")
import legacyIndex = require("esm-sync/index.js")
import legacyEsm = require("esm-sync/esm")

declare const mod: Module

const load = esm(mod)
const publicLoad: typeof load = publicEntry(mod)
const indexLoad: typeof load = legacyIndex(mod)
const esmLoad: typeof load = legacyEsm(mod)
const configuredLoad = esm(mod, {
  await: true,
  cache: ".cache/esm-sync",
  debug: true,
  sourceMap: false,
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
  force: false,
  mainFields: ["module", "main"],
  mode: "strict",
  wasm: false
})

const result: unknown = load("./example")
const configuredResult: unknown = configuredLoad("./example")

// @ts-expect-error Mode is limited to the three supported values.
esm(mod, { mode: "unsupported" })
// @ts-expect-error CommonJS options only accept booleans.
esm(mod, { cjs: { cache: "enabled" } })
// @ts-expect-error Main fields must be a string array.
esm(mod, { mainFields: "main" })
// @ts-expect-error Subpath aliases retain the same checked options.
legacyIndex(mod, { mode: "unsupported" })

void result
void configuredResult
void publicLoad
void indexLoad
void esmLoad
