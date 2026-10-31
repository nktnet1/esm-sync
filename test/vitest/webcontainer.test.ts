import { realpathSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { withCompatibilityFiles } from "./helpers/coverage.ts"
import { runNode, testEnvironments } from "./helpers/run-node.ts"

for (const esmEnv of testEnvironments) {
  describe(`shared-realm VM hosts (${esmEnv})`, () => {
    it("loads ESM without deleting live host globals when vm contexts share their realm", async () => {
      const loader = realpathSync(path.resolve("dist/esm.js"))
      await withCompatibilityFiles(
        {
          "value.js": "export const answer = Object.keys({answer:42}).length + 41",
          "index.cjs": `const assert = require('node:assert/strict')
const vm = require('node:vm')
const nativeObject = Object
const descriptors = nativeObject.getOwnPropertyDescriptors(global)
const nativeRun = vm.Script.prototype.runInContext
const runInThisContext = vm.Script.prototype.runInThisContext
const runInNewContext = vm.Script.prototype.runInNewContext
const hostFacade = new Proxy(global,{})
const contexts = new WeakSet()
let sharedRuns = 0
// A VM shim can represent contexts while evaluating their scripts in the
// host realm. Deleting a builtin from the proxy then deletes the live global.
vm.createContext = sandbox => {
  const context = new Proxy(sandbox,{})
  contexts.add(context)
  return context
}
vm.Script.prototype.runInNewContext = function(sandbox,options) {
  if (sandbox && sandbox.global === global) sandbox.global = hostFacade
  return Reflect.apply(runInNewContext,this,[sandbox,options])
}
vm.Script.prototype.runInContext = function(context,options) {
  if (!contexts.has(context)) return Reflect.apply(nativeRun,this,[context,options])
  sharedRuns++
  assert.equal(typeof global.Object,'function','VM host lost Object during context preparation')
  return Reflect.apply(runInThisContext,this,[options])
}
try {
  const load = require(${JSON.stringify(loader)})(module)
  assert.equal(load('./value.js').answer,42)
  assert.ok(sharedRuns > 0,'The shared-realm VM path was not exercised')
  for (const name of ['Object','Function','Array','Error','Promise','Reflect','Symbol']) {
    assert.deepEqual(nativeObject.getOwnPropertyDescriptor(global,name),descriptors[name],name)
  }
  console.log('shared-realm:pass')
} finally {
  nativeObject.defineProperties(global,descriptors)
}`
        },
        async (directory) => {
          for (const cache of [false, path.join(directory, "esm-cache")]) {
            for (let run = 0; run < 2; run++) {
              const result = await runNode(
                ["index.cjs"],
                esmEnv,
                {
                  ESM_DISABLE_CACHE: String(cache === false),
                  ESM_OPTIONS: JSON.stringify({ cjs: true, mode: "auto", cache })
                },
                { cwd: directory }
              )
              expect(result.exitCode, `cache=${cache}, run=${run}\n${result.stderr}`).toBe(0)
              expect(result.stdout.trim()).toBe("shared-realm:pass")
            }
          }
        }
      )
    })
  })
}
