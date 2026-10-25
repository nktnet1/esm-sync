const esm = require("../esm") as import("../src/types/public.js").EsmFactory

const myRequire = esm(module)

const data: unknown = myRequire("./module")

console.log(data)
