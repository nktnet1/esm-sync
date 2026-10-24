"use strict";
const esm = require("../esm");
const myRequire = esm(module);
const data = myRequire("./module");
console.log(data);
