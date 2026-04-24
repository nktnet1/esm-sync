import assert from "assert"
import semver from "semver"
import makeRequire from "../../../index.js"
import module from "../../module.js"

export default () => {
  const esmRequire = makeRequire(module, {
    mainFields: ["module", "main"]
  })

  assert.strictEqual(esmRequire("main-fields").default, "module")
  assert.ok(esmRequire.resolve("main-fields").endsWith("module.js"))

  // From node 18+, this will fail with:
  //     file:///esm-sync/test/node_modules/main-fields-mjs/main.mjs:1
  //         export default "main"
  //            ^ SyntaxError: Unexpected token 'export'
  if (semver.lte(process.versions.node, "18.0.0")) {
    assert.strictEqual(esmRequire("main-fields-mjs").default, "main")
  }
  assert.ok(esmRequire.resolve("main-fields-mjs").endsWith("main.mjs"))

  return Promise
    .all([
      import("main-fields")
        .then((ns) => assert.strictEqual(ns.default, "module")),
      import("main-fields-mjs")
        .then((ns) => assert.strictEqual(ns.default, "main"))
    ])
}
