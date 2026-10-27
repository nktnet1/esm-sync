// Preserve the legacy index entry for resolvers that ignore package exports.
// Forward to the generated bootstrap so all entries share the same factory.
module.exports = require("./dist/index.js")
