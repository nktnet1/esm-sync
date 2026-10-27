// Older Node resolvers and direct filesystem imports need this physical entry.
// Package export maps cannot redirect those paths to the generated bootstrap.
module.exports = require("./dist/esm.js")
