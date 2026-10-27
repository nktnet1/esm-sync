// Direct index.js imports and older TypeScript resolvers need this type entry.
// Re-export generated types so legacy imports receive the same options and API.
import esm = require("./dist/index.js")
export = esm
