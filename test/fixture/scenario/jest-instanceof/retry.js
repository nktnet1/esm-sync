"use strict"

const Type = require("./type.js")
const value = new Type()

if (value.number === 1) {
  throw new Error("First load failed")
}

module.exports = value
