import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.mts"

const fixtures = {
  "source.mjs": `export let count = 1
export const left = "left"
export const right = "right"
export function setCount(value) { count = value }
`,
  "direct.mjs": 'export { count } from "./source.mjs"\n',
  "indirect.mjs": 'export { local as count }; import { count as local } from "./source.mjs"\n',
  "merge.mjs": 'export * from "./direct.mjs"; export * from "./indirect.mjs"\n',
  "namespace-direct.mjs": 'export * as shared from "./source.mjs"\n',
  "namespace-direct-two.mjs": 'export * as shared from "./source.mjs"\n',
  "namespace-merge.mjs":
    'export * from "./namespace-direct.mjs"; export * from "./namespace-direct-two.mjs"\n',
  "positive.mjs": `import { count as mergedCount } from "./merge.mjs"
import { shared } from "./namespace-merge.mjs"
import * as originalNamespace from "./source.mjs"
import { setCount } from "./source.mjs"
if (mergedCount !== 1 || shared !== originalNamespace) throw new Error("wrong original binding")
setCount(3)
if (mergedCount !== 3 || shared.count !== 3) throw new Error("lost live binding")
console.log("export-binding-identity:true")
`,
  "alias-left.mjs": 'export { left as selection } from "./source.mjs"\n',
  "alias-right.mjs": 'export { right as selection } from "./source.mjs"\n',
  "conflict.mjs": 'export * from "./alias-left.mjs"; export * from "./alias-right.mjs"\n',
  "negative.mjs": 'import { selection } from "./conflict.mjs"; console.log(selection)\n',
  "report-error.cjs":
    'process.once("uncaughtExceptionMonitor", (error) => process.stderr.write(`binding-error:${error.name}\\n`))\n'
}

async function withFixtures(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(testPath, "fixture/export/star-binding-"))

  try {
    await Promise.all(
      Object.entries(fixtures).map(([name, code]) => writeFile(path.join(directory, name), code))
    )
    await run(directory)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

for (const esmEnv of testEnvironments) {
  describe(`re-export binding identity (${esmEnv})`, () => {
    const options = { ESM_OPTIONS: "{cjs:false,mode:'auto'}" }

    it("treats duplicate paths to the same binding as unambiguous and live", async () => {
      await withFixtures(async (directory) => {
        const { exitCode, stdout, stderr } = await runNode(
          ["-r", "../index.js", path.join(directory, "positive.mjs")],
          esmEnv,
          options,
          { cacheNamespace: "export-binding-identity" }
        )

        assert.equal(exitCode, 0, stderr.slice(-4000))
        assert.ok(stdout.includes("export-binding-identity:true"), stdout)
      })
    })

    it("rejects different bindings from the same source module", async () => {
      await withFixtures(async (directory) => {
        const { exitCode, stdout, stderr } = await runNode(
          [
            "-r",
            path.join(directory, "report-error.cjs"),
            "-r",
            "../index.js",
            path.join(directory, "negative.mjs")
          ],
          esmEnv,
          options,
          { cacheNamespace: "export-binding-conflict" }
        )

        assert.notEqual(exitCode, 0)
        assert.ok(/^binding-error:SyntaxError$/m.test(stderr), stderr.slice(-4000))
        assert.equal(stdout, "")
      })
    })
  })
}
