"use strict"
const { parentPort } = require("node:worker_threads")
const esmRequire = require("esm-sync")(module)
parentPort.postMessage({ format: "cjs", counter: esmRequire("../counter.mjs").counter })
