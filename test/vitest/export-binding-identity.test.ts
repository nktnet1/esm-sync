import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "vitest"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

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
  "namespace-import-one.mjs": 'import * as ns from "./source.mjs"; export { ns as shared }\n',
  "namespace-import-two.mjs": 'import * as ns from "./source.mjs"; export { ns as shared }\n',
  "namespace-import-late.mjs": 'export { ns as shared }; import * as ns from "./source.mjs"\n',
  "namespace-import-merge.mjs":
    'export * from "./namespace-import-one.mjs"; export * from "./namespace-import-two.mjs"\n',
  "namespace-mixed-merge.mjs":
    'export * from "./namespace-import-late.mjs"; export * from "./namespace-direct.mjs"\n',
  "positive.mjs": `import { count as mergedCount } from "./merge.mjs"
import { shared } from "./namespace-merge.mjs"
import { shared as importedShared } from "./namespace-import-merge.mjs"
import { shared as mixedShared } from "./namespace-mixed-merge.mjs"
import * as originalNamespace from "./source.mjs"
import { setCount } from "./source.mjs"
if (mergedCount !== 1 || shared !== originalNamespace || importedShared !== shared || mixedShared !== shared) throw new Error("wrong original binding")
setCount(3)
if (mergedCount !== 3 || shared.count !== 3 || importedShared.count !== 3) throw new Error("lost live binding")
console.log("export-binding-identity:true")
`,
  "alias-left.mjs": 'export { left as selection } from "./source.mjs"\n',
  "alias-right.mjs": 'export { right as selection } from "./source.mjs"\n',
  "conflict.mjs": 'export * from "./alias-left.mjs"; export * from "./alias-right.mjs"\n',
  "negative.mjs": 'import { selection } from "./conflict.mjs"; console.log(selection)\n',
  "other-source.mjs": "export const other = 42\n",
  "namespace-import-other.mjs":
    'import * as ns from "./other-source.mjs"; export { ns as shared }\n',
  "namespace-conflict.mjs":
    'export * from "./namespace-import-one.mjs"; export * from "./namespace-import-other.mjs"\n',
  "namespace-negative.mjs":
    'import { shared } from "./namespace-conflict.mjs"; console.log(shared)\n',
  "cycle-single-root.mjs":
    'export * from "./cycle-single-forward.mjs"; export * from "./source.mjs"\n',
  "cycle-single-forward.mjs": 'export { count } from "./cycle-single-root.mjs"\n',
  "cycle-multi-root.mjs":
    'export * from "./cycle-multi-forward-a.mjs"; export * from "./source.mjs"; export * from "./cycle-multi-forward-b.mjs"\n',
  "cycle-multi-forward-a.mjs": 'export { count } from "./cycle-multi-root.mjs"\n',
  "cycle-multi-forward-b.mjs": 'export { count } from "./cycle-multi-root.mjs"\n',
  "cycle-nested-root.mjs":
    'export * from "./cycle-nested-forward-a.mjs"; export * from "./source.mjs"\n',
  "cycle-nested-forward-a.mjs": 'export { count } from "./cycle-nested-forward-b.mjs"\n',
  "cycle-nested-forward-b.mjs": 'export { count } from "./cycle-nested-root.mjs"\n',
  "cycle-positive.mjs": `import { count as single } from "./cycle-single-root.mjs"
import { count as multi } from "./cycle-multi-root.mjs"
import { count as nested } from "./cycle-nested-root.mjs"
import { setCount } from "./source.mjs"
if (single !== 1 || multi !== 1 || nested !== 1) throw new Error("wrong cyclic star binding")
setCount(6)
if (single !== 6 || multi !== 6 || nested !== 6) throw new Error("lost cyclic star live binding")
console.log("cyclic-star-resolution:true")
`,
  "cycle-missing-root.mjs": 'export * from "./cycle-missing-forward.mjs"\n',
  "cycle-missing-forward.mjs": 'export { count } from "./cycle-missing-root.mjs"\n',
  "cycle-missing-negative.mjs":
    'import { count } from "./cycle-missing-root.mjs"; console.log(count)\n',
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

    it("rejects conflicting namespace bindings from different source modules", async () => {
      await withFixtures(async (directory) => {
        const { exitCode, stdout, stderr } = await runNode(
          [
            "-r",
            path.join(directory, "report-error.cjs"),
            "-r",
            "../index.js",
            path.join(directory, "namespace-negative.mjs")
          ],
          esmEnv,
          options,
          { cacheNamespace: "export-namespace-conflict" }
        )

        assert.notEqual(exitCode, 0)
        assert.ok(/^binding-error:SyntaxError$/m.test(stderr), stderr.slice(-4000))
        assert.equal(stdout, "")
      })
    })

    it("ignores cyclic indirect export-star paths while retaining live bindings", async () => {
      await withFixtures(async (directory) => {
        const { exitCode, stdout, stderr } = await runNode(
          ["-r", "../index.js", path.join(directory, "cycle-positive.mjs")],
          esmEnv,
          options,
          { cacheNamespace: "export-cycle-resolution" }
        )

        assert.equal(exitCode, 0, stderr.slice(-4000))
        assert.ok(stdout.includes("cyclic-star-resolution:true"), stdout)
      })
    })

    it("rejects an export-star cycle without any concrete binding", async () => {
      await withFixtures(async (directory) => {
        const { exitCode, stdout, stderr } = await runNode(
          [
            "-r",
            path.join(directory, "report-error.cjs"),
            "-r",
            "../index.js",
            path.join(directory, "cycle-missing-negative.mjs")
          ],
          esmEnv,
          options,
          { cacheNamespace: "export-cycle-missing" }
        )

        assert.notEqual(exitCode, 0)
        assert.ok(/^binding-error:SyntaxError$/m.test(stderr), stderr.slice(-4000))
        assert.equal(stdout, "")
      })
    })

    it("retains local namespace values when CommonJS dependencies are mocked", async () => {
      const { exitCode, stdout, stderr } = await runNode(
        ["-r", "../index.js", "fixture/scenario/mock-require-inject"],
        esmEnv,
        { ESM_OPTIONS: "{cjs:true,mode:'auto'}" },
        { cacheNamespace: "export-namespace-mocking", timeout: 15_000 }
      )

      assert.equal(exitCode, 0, stderr.slice(-4000))
      assert.equal(stderr, "")
      assert.equal(stdout, "")
    })
  })
}
