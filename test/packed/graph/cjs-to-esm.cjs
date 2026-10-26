"use strict"

const esmRequire = require("esm-sync")(module)
const dependency = esmRequire("./esm-to-cjs.mjs")

module.exports = {
  read: () => dependency.read(),
  increment: () => dependency.increment()
}
