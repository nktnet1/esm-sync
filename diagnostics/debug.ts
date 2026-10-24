const esm = require("../esm") as typeof import("../bootstrap/esm.js")

const myRequire = esm(module)

const data: unknown = myRequire("./module")

console.log(data)
