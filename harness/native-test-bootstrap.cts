"use strict"

// Load node:test before esm-sync patches Module internals. Older loader
// versions do not recognise the 'node:test' built-in specifier themselves.
globalThis.__esmSyncNativeTest = require("node:test") as typeof import("node:test")
export {}
