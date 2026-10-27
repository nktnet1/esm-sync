import esm = require("../../../esm.js")
import index = require("../../../index.js")

const load: NodeJS.Require = esm(module, { cjs: { vars: true } })
const loadIndex: NodeJS.Require = index(module, { mode: "auto" })
void [load, loadIndex]
