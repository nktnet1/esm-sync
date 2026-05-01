"use strict"

require = require("../../../../index.js")(
  module,
  {
    cjs: {
      paths: true
    }
  }
)
require("@babel/register")
require("./main.js")
