import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it, expect } from "vitest"
import Compiler from "../../dist/build/compiler.js"
import { runNode, testEnvironments, testPath } from "./helpers/run-node.ts"

const loaderPath = path.resolve(testPath, "../esm.js")
const cases = [
  ["block", "{ var value = 1 }", "1"],
  ["if", "if (true) { var value = 2 }", "2"],
  ["unexecuted branch", "if (false) { var value = 2 }", "undefined"],
  ["else", "if (false) {} else { var value = 3 }", "3"],
  ["while", "while (typeof value === 'undefined') { var value = 4 }", "4"],
  ["do while", "do { var value = 5 } while (false)", "5"],
  ["for initializer", "for (var value = 0; value < 3; value++) {}", "3"],
  ["for body", "for (let i = 0; i < 1; i++) { var value = 6 }", "6"],
  ["for in", "for (var value in { answer: 1 }) {}", '"answer"'],
  ["for of pattern", "for (var { x: value } of [{ x: 7 }]) {}", "7"],
  ["switch", "switch (1) { case 1: var value = 8; break }", "8"],
  ["try", "try { var value = 9 } catch (error) {}", "9"],
  ["catch", "try { throw [10] } catch (error) { var [value] = error }", "10"],
  ["catch parameter", "try { throw 1 } catch (value) { var value = 2 }", "undefined"],
  ["finally", "try {} finally { var value = 11 }", "11"],
  ["label", "outer: { var value = 12; break outer }", "12"],
  ["nested pattern", "if (true) { var { x: [value = 13] } = { x: [] } }", "13"],
  ["array rest", "{ var [,,...value] = [1, 2, 3, 4] }", "[3,4]"],
  ["object rest", "{ var { x, ...value } = { x: 1, y: 2 } }", '{"y":2}']
] as const

const privateBindings = [
  "{ let value = 1 }",
  "{ const value = 1 }",
  "{ class value {} }",
  "{ function value() {} }",
  "function outer() { var value = 1 }",
  "function outer(value) {}",
  "const outer = () => { var value = 1 }",
  "(function () { var value = 1 })()",
  "const outer = { method() { var value = 1 } }",
  "class Outer { method() { var value = 1 } }",
  "class Outer { static { var value = 1 } }",
  "try { throw 1 } catch (value) {}",
  "for (let value of []) {}"
]

describe("hoisted module bindings", () => {
  for (const [name, code] of cases) {
    it(`recognizes a var in a ${name}`, () => {
      for (const sourceType of [2, 3]) {
        // Exports may precede declarations, including an unexecuted branch.
        expect(() => Compiler.compile(`export { value };\n${code}`, { sourceType })).not.toThrow()
      }
    })
  }

  for (const code of privateBindings) {
    it(`does not expose a nested binding from ${code}`, () => {
      expect(() => Compiler.compile(`${code}\nexport { value }`, { sourceType: 2 })).toThrow(
        /Export 'value' is not defined in module/
      )
    })
  }

  it("checks hoisted var and module function conflicts in both declaration orders", () => {
    for (const declaration of ["if (true) { var value }", "for (var value of []) {}"])
      for (const code of [
        `${declaration}; function value() {}`,
        `function value() {}; ${declaration}`
      ]) {
        expect(() => Compiler.compile(`${code}; export {}`, { sourceType: 2 })).toThrow(
          /Identifier 'value' has already been declared/
        )
        expect(() => Compiler.compile(code, { sourceType: 1 })).not.toThrow()
      }
  })
})

async function withFiles(
  files: Record<string, string>,
  run: (directory: string) => Promise<void>
): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-hoisted-")))
  try {
    for (const [name, contents] of Object.entries(files)) {
      const filename = path.join(directory, name)
      await mkdir(path.dirname(filename), { recursive: true })
      await writeFile(filename, contents)
    }
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

for (const esmEnv of testEnvironments) {
  describe.concurrent(`hoisted var exports (${esmEnv})`, () => {
    for (const [name, code, output] of cases) {
      it(`keeps ${name} exports live and matches native Node`, async ({ expect }) => {
        await withFiles(
          {
            "package.json": '{ "type": "module" }',
            "value.js": `export { value };\n${code}\nexport function update(next) { value = next }\n`,
            "index.js": `import { value, update } from './value.js'
console.log(JSON.stringify(value))
update('updated')
console.log(value)
`,
            "value.mjs": `export { value };\n${code}\nexport function update(next) { value = next }\n`,
            "index.mjs": `import { value, update } from './value.mjs'
console.log(JSON.stringify(value))
update('updated')
console.log(value)
`
          },
          async (directory) => {
            for (const extension of ["js", "mjs"]) {
              const filename = path.join(directory, `index.${extension}`)
              for (const args of [[filename], ["-r", loaderPath, filename]]) {
                const result = await runNode(
                  args,
                  esmEnv,
                  { ESM_OPTIONS: "{cjs:false,mode:'auto'}" },
                  {
                    cacheNamespace: "hoisted-vars-" + name.replace(/ /g, "-")
                  }
                )
                expect(result.exitCode, result.stderr.slice(-4_000)).toBe(0)
                expect(result.stderr).toBe("")
                expect(result.stdout.trim()).toBe(`${output}\nupdated`)
              }
            }
          }
        )
      })
    }

    it("initializes a hoisted var before a cyclic import observes it", async ({ expect }) => {
      await withFiles(
        {
          "value.mjs": `import { observe } from './observer.mjs'
if (observe() !== undefined) throw new Error('var was not initialized during linking')
if (true) { var value = 1 }
export { value }
console.log(observe())
`,
          "observer.mjs":
            "import { value } from './value.mjs'; export function observe() { return value }\n"
        },
        async (directory) => {
          const filename = path.join(directory, "value.mjs")
          for (const args of [[filename], ["-r", loaderPath, filename]]) {
            const result = await runNode(
              args,
              esmEnv,
              { ESM_OPTIONS: "{cjs:false,mode:'auto'}" },
              {
                cacheNamespace: "hoisted-vars-cycle"
              }
            )
            expect(result.exitCode, result.stderr.slice(-4_000)).toBe(0)
            expect(result.stderr).toBe("")
            expect(result.stdout.trim()).toBe("1")
          }
        }
      )
    })
  })
}
