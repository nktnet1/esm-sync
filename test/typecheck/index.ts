import type { Module } from "node:module"

import esm = require("../../index")

declare const mod: Module

const load = esm(mod)
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

void result
void configuredResult
