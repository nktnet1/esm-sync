"use strict"

const Type = require("./type.js")
const value = require("./value.js")

// Match js-yaml's validation in import-sync#138: the instance and validator
// reach the same constructor through different CommonJS dependency paths.
if (!(value instanceof Type)) {
  throw new TypeError("Expected a Type instance")
}

module.exports = { Type, value, accepts: (value) => value instanceof Type }
