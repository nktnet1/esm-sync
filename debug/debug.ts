const esm = require("../esm") as typeof import("../index.js")

const myRequire = esm(module)

const data: unknown = myRequire("./module")

console.log(data)
