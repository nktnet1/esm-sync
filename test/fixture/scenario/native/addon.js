"use strict"

// CJS/ESM interoperability must resolve an actual Node-API binary, not a mock.
exports.add = require("./addon.node").add
