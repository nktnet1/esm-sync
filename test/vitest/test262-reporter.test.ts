import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"
import { fileURLToPath } from "node:url"
import execa from "execa"
import { describe, it, expect } from "vitest"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const reporter = path.join(root, "dist/script/test262-reporter.js")

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return execa.sync(process.execPath, [command, ...args], {
    cwd: root,
    reject: false,
    env: { ...process.env, FORCE_COLOR: "1", NO_COLOR: undefined, ...env }
  })
}

function withFixtureRunner(check: (command: string, env: NodeJS.ProcessEnv) => void): void {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-sync-test262-cli-")))
  const scriptDirectory = path.join(directory, "dist/script")
  const testDirectory = path.join(directory, "dist/test")
  try {
    mkdirSync(scriptDirectory, { recursive: true })
    mkdirSync(testDirectory, { recursive: true })
    mkdirSync(path.join(directory, "dist/build"), { recursive: true })
    mkdirSync(path.join(directory, "dist/esm"), { recursive: true })
    for (const filename of ["run-test262.js", "test262-reporter.js"]) {
      copyFileSync(path.join(root, "dist/script", filename), path.join(scriptDirectory, filename))
    }
    // The CLI verifies these bundle paths; this fixture is only testing
    // reporter selection and does not execute esm-sync itself.
    writeFileSync(path.join(directory, "dist/build/compiler.js"), "")
    writeFileSync(path.join(directory, "dist/esm/loader.js"), "")
    writeFileSync(
      path.join(testDirectory, "test262.mjs"),
      `
      import { describe, it } from "node:test"
      describe("Test262 conformance (fixture)", () => {
        it("first (test/language/export/first.js)", () => {})
        it("second (test/language/export/second.js)", () => {})
      })
    `
    )
    const env = {
      NODE_PATH: [path.join(root, "node_modules"), process.env.NODE_PATH]
        .filter(Boolean)
        .join(path.delimiter)
    }
    check(path.join(scriptDirectory, "run-test262.js"), env)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe("Test262 grouped reporter", () => {
  it("groups cases by directory and colours only result tokens", () => {
    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "esm-sync-test262-reporter-"))
    )
    const fixture = path.join(directory, "fixture.cjs")
    try {
      writeFileSync(
        fixture,
        `const { describe, it } = require("node:test")
         console.log("Test262: selected 3 cases")
         describe("Test262 conformance (revision)", () => {
           it("first case (test/language/export/first.js)", () => {})
           it("unsupported (test/language/expressions/dynamic-import/skip.js)", { skip: "unsupported host feature" }, () => {})
           it("failing case (test/language/expressions/dynamic-import/fail.js)", () => { throw new Error("intentional failure") })
         })\n`
      )
      const { exitCode, stdout, stderr } = run("--test", [`--test-reporter=${reporter}`, fixture])
      expect(exitCode, stderr).toBe(1)
      const output = stripVTControlCharacters(stdout)

      expect(output).toMatch(/TEST262 {2}Test262 conformance \(revision\)/)
      expect(output).toMatch(/\n {2}export\n {2}-+\n {4}PASS {2}first\.js/)
      expect(output).toMatch(/\n {2}expressions \/ dynamic-import\n {2}-+\n {4}SKIP {2}skip\.js/)
      expect(output).toMatch(/FAIL {2}fail\.js/)
      expect(output).toMatch(/unsupported host feature/)
      expect(output).toMatch(/intentional failure/)
      expect(output).toMatch(/RESULTS\n {2}-+\n {4}PASS 1 {4}FAIL 1 {4}SKIP 1 {4}TODO 0/)
      expect(output).not.toMatch(/FAIL {2}Test262 conformance/)

      const fragments = stdout.split(String.fromCharCode(27))
      const colouredSpans = fragments
        .filter((_, index) => index % 2 === 1)
        .map((fragment) => fragment.replace(/^\[[\d;]*m/, ""))
      expect(colouredSpans, "PASS should be coloured").toContain("PASS")
      expect(colouredSpans, "FAIL should be coloured").toContain("FAIL")
      expect(colouredSpans, "SKIP should be coloured").toContain("SKIP")
      expect(
        colouredSpans.filter(
          (span) => !["TEST262", "RESULTS", "PASS", "FAIL", "SKIP", "TODO"].includes(span)
        ),
        `Only status and heading tokens may be coloured: ${colouredSpans.join(", ")}`
      ).toStrictEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("uses the grouped reporter for the default conformance command", () => {
    withFixtureRunner((command, env) => {
      const { exitCode, stdout, stderr } = run(command, [], env)
      expect(exitCode, stderr || stdout).toBe(0)
      const output = stripVTControlCharacters(stdout)
      expect(output).toMatch(/TEST262 {2}Test262 conformance/)
      expect(output).toMatch(/\n {2}export\n {2}-+\n {4}PASS/)
      expect(output).toMatch(/RESULTS\n {2}-+\n {4}PASS 2 {4}FAIL 0 {4}SKIP 0/)
    })
  })

  it("preserves Node's dot reporter when explicitly requested", () => {
    withFixtureRunner((command, env) => {
      const { exitCode, stdout, stderr } = run(command, ["--reporter", "dot"], env)
      expect(exitCode, stderr || stdout).toBe(0)
      const output = stripVTControlCharacters(stdout)
      expect(output).not.toMatch(/RESULTS\n/)
      expect(output).toMatch(/\.\./)
    })
  })
})
