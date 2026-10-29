import { describe, it, expect } from "vitest"
import Compiler from "../../dist/build/compiler.js"

const SCRIPT = 1
const MODULE = 2
const UNAMBIGUOUS = 3

const modernTypes = [MODULE, UNAMBIGUOUS]
const sourceTypes = [SCRIPT, MODULE, UNAMBIGUOUS]
const testGlobal: typeof globalThis & { called?: number } = globalThis

describe("compiler tests", () => {
  it("should support `options.topLevelReturn`", () => {
    expect(() => Compiler.compile("return")).not.toThrow()

    expect(() =>
      Compiler.compile("return", {
        sourceType: MODULE,
        topLevelReturn: true
      })
    ).not.toThrow()

    expect(() =>
      Compiler.compile("return", {
        sourceType: MODULE
      })
    ).toThrow(
      expect.objectContaining({
        name: "SyntaxError",
        message: expect.stringMatching(/Illegal return statement/)
      })
    )
  })

  it("should support `options.sourceType`", () => {
    for (const sourceType of modernTypes) {
      const result = Compiler.compile('import"a"', { sourceType })

      expect(result.sourceType).toBe(MODULE)
    }
  })

  it("should support `options.cjsVars`", () => {
    const code = "arguments"

    let result = Compiler.compile(code)

    expect(result.code).toBe(code)

    result = Compiler.compile(code, {
      cjsVars: true,
      sourceType: MODULE
    })

    expect(result.code).toBe(code)

    result = Compiler.compile(code, { sourceType: MODULE })

    expect(result.code).toContain('_.t("arguments")')
  })

  it("should support `options.sourceType` of MODULE", () => {
    const datas = [
      { code: "1+2", sourceType: MODULE },
      { code: "1+2//import", sourceType: MODULE },
      { code: "1+2//import.meta", sourceType: MODULE },
      { code: '"use module";1+2', sourceType: MODULE },
      { code: "'use module';1+2", sourceType: MODULE },
      { code: '"use script";1+2', sourceType: SCRIPT },
      { code: "'use script';1+2", hint: MODULE, sourceType: MODULE },
      { code: "import'a'", sourceType: MODULE },
      { code: 'import"a"', sourceType: MODULE },
      { code: "import.meta", sourceType: MODULE }
    ]

    for (const { code, hint, sourceType } of datas) {
      const result = Compiler.compile(code, {
        hint,
        sourceType: MODULE
      })

      expect(result.sourceType).toBe(sourceType)
    }
  })

  it("should support `options.sourceType` of UNAMBIGUOUS", () => {
    const datas = [
      { code: "1+2", sourceType: SCRIPT },
      { code: "1+2//import", sourceType: SCRIPT },
      { code: "1+2//import.meta", sourceType: SCRIPT },
      { code: "return 1+2//eval", sourceType: SCRIPT },
      { code: "1+2", hint: MODULE, sourceType: MODULE },
      { code: '"use module";1+2', sourceType: MODULE },
      { code: "'use module';1+2", hint: MODULE, sourceType: MODULE },
      { code: '"use script";1+2', sourceType: SCRIPT },
      { code: "'use script';1+2", hint: MODULE, sourceType: MODULE },
      { code: "import'a'", sourceType: MODULE },
      { code: 'import"a"', hint: MODULE, sourceType: MODULE },
      { code: "import.meta", sourceType: MODULE },
      { code: "import.meta", hint: MODULE, sourceType: MODULE }
    ]

    for (const { code, hint, sourceType } of datas) {
      const result = Compiler.compile(code, {
        hint,
        sourceType: UNAMBIGUOUS
      })

      expect(result.sourceType).toBe(sourceType)
    }
  })

  it("should support `options.generateVarDeclarations`", () => {
    const values = [void 0, false, true]

    for (const value of values) {
      for (const sourceType of modernTypes) {
        const result = Compiler.compile('import a from "a"', {
          generateVarDeclarations: value,
          sourceType
        })

        expect(result.code).toContain(value ? "var a" : "let a")
      }
    }
  })

  it("recognizes await-only modules without imports or exports", () => {
    for (const code of [
      "await Promise.resolve(42)",
      "const value = await Promise.resolve(42)",
      "for await (const value of [42]) {}",
      "await using resource = globalThis.resource"
    ]) {
      const result = Compiler.compile(code, { sourceType: UNAMBIGUOUS, cjsVars: true })
      expect(result.sourceType, code).toBe(MODULE)
      expect(result.firstAwaitOutsideFunction, code).not.toBeNull()
      expect(result.transforms & 1024, code).toBe(1024)
      expect(result.code, code).toContain("yield")
    }
  })

  it("preserves scripts with await identifiers and nested awaits", () => {
    for (const sourceType of [SCRIPT, UNAMBIGUOUS]) {
      for (const code of [
        "var await = 42; module.exports = await",
        "function read(await) { return await }; module.exports = read(42)",
        "module.exports = { await: 42 }",
        "async function read() { return await Promise.resolve(42) }; module.exports = read",
        'module.exports = "await is text"',
        "// await is a comment\nmodule.exports = require('node:path')"
      ]) {
        const result = Compiler.compile(code, { sourceType, cjsVars: true })
        expect(result.sourceType, code).toBe(SCRIPT)
        expect(result.firstAwaitOutsideFunction, code).toBeNull()
        expect(result.code, code).toBe(code)
        expect(result.transforms, code).toBe(0)
      }
    }
  })

  it("retains the script goal for legacy await with unshadowed CommonJS exports", () => {
    for (const code of [
      "await Promise.resolve(); exports.value = 42",
      "await Promise.resolve(); module.exports = 42"
    ]) {
      const result = Compiler.compile(code, { sourceType: UNAMBIGUOUS, cjsVars: false })
      expect(result.sourceType, code).toBe(SCRIPT)
      expect(result.firstAwaitOutsideFunction, code).not.toBeNull()
      expect(result.transforms, code).toBe(0)
      expect(result.code, code).toBe(code)
    }
    for (const code of [
      "const exports = {}; await Promise.resolve(); exports.value = 42",
      "const module = {}; await Promise.resolve(); module.exports = 42",
      'await Promise.resolve(); console.log("module.exports")',
      "await Promise.resolve(); const object = {exports: 42}",
      "await Promise.resolve(); globalThis.object.exports = 42",
      "await Promise.resolve(); function read(exports) { return exports.value }",
      "await Promise.resolve(); { const module = {}; module.exports = 42 }"
    ]) {
      expect(Compiler.compile(code, { sourceType: UNAMBIGUOUS }).sourceType, code).toBe(MODULE)
    }
  })

  it('should support the "use module" directive', () => {
    const datas = [
      { code: "'use module';\"use script\";import'a'" },
      { code: "'use module';\"use script\";import.meta" },
      { code: '"use module";\'use script\';import"a"' },
      { code: "\"use module\";'use script';import.meta" },
      { code: "'use module';\"use script\";import'a'", hint: MODULE },
      { code: "'use module';\"use script\";import.meta", hint: MODULE },
      { code: '"use module";\'use script\';import"a"', hint: MODULE },
      { code: "\"use module\";'use script';import.meta", hint: MODULE }
    ]

    for (const { code, hint } of datas) {
      const result = Compiler.compile(code, {
        hint,
        sourceType: UNAMBIGUOUS
      })

      expect(result.sourceType).toBe(MODULE)
    }
  })

  it('should support the "use script" directive', () => {
    const datas = [
      { code: "'use script';\"use module\";import'a'", hint: SCRIPT },
      { code: "'use script';\"use module\";import.meta", hint: SCRIPT },
      { code: '"use script";\'use module\';import"a"', hint: SCRIPT },
      { code: "\"use script\";'use module';import.meta", hint: SCRIPT },
      { code: "'use script';\"use module\";import'a'" },
      { code: "'use script';\"use module\";import.meta" },
      { code: '"use script";\'use module\';import"a"' },
      { code: "\"use script\";'use module';import.meta" }
    ]

    for (const { code, hint } of datas) {
      expect(() =>
        Compiler.compile(code, {
          hint,
          sourceType: UNAMBIGUOUS
        })
      ).toThrow(expect.objectContaining({ name: "SyntaxError" }))
    }
  })

  it("should support shebangs", () => {
    const shebang = "#!/usr/bin/env node"

    const code = [shebang, 'import a from "a"'].join("\n")

    for (const sourceType of modernTypes) {
      const result = Compiler.compile(code, { sourceType })

      expect(result.code.includes(shebang)).toBe(false)
    }
  })

  it("should support trailing comments", () => {
    for (const sourceType of modernTypes) {
      const result = Compiler.compile('import"a"//trailing comment', { sourceType })

      expect(result.code).toMatch(/\/\/trailing comment$/)
    }
  })

  it("should compile dynamic import for SCRIPT", () => {
    const result = Compiler.compile('import("a")', {
      sourceType: SCRIPT
    })

    expect(result.code).toContain('i("a")')
  })

  it("should preserve the evaluation of a second dynamic import argument", () => {
    const code = 'import("fixture", (globalThis.called += 1, {}),)'

    for (const sourceType of sourceTypes) {
      const { code: transformed } = Compiler.compile(code, { sourceType })
      const runtime = {
        i(_specifier: unknown, options: unknown) {
          return options
        }
      }

      testGlobal.called = 0

      try {
        expect(new Function("_", `return ${transformed}`)(runtime)).toStrictEqual({})
        expect(testGlobal.called).toBe(1)
      } finally {
        delete testGlobal.called
      }
    }
  })

  it("should compile dynamic source and defer imports as call syntax", () => {
    for (const phase of ["source", "defer"]) {
      for (const sourceType of sourceTypes) {
        const calls: string[] = []
        const code = `import.${phase}((calls.push("specifier"), "fixture"), (calls.push("options"), {}),)`
        const { code: transformed } = Compiler.compile(code, { sourceType })
        const runtime = {
          p(request: unknown, options: unknown) {
            calls.push("source")
            return [request, options]
          },
          q(request: unknown, options: unknown) {
            calls.push("defer")
            return [request, options]
          }
        }

        const result: unknown = new Function("_", "calls", `return ${transformed}`)(runtime, calls)

        expect(result).toStrictEqual(["fixture", {}])
        expect(calls).toStrictEqual(["specifier", "options", phase])
      }
    }
  })

  it("should reject invalid phase-qualified import syntax", () => {
    const lines = [
      "import.source",
      "import.defer",
      'import.foo("fixture")',
      'import.sour\\u0063e("fixture")',
      'import.d\\u0065fer("fixture")',
      "import.source()",
      'import.source("fixture", {}, {})',
      "import.defer?.('fixture')",
      'new import.source("fixture")',
      'new import.defer("fixture")'
    ]

    for (const line of lines) {
      expect(() => Compiler.compile(line, { sourceType: MODULE }), line).toThrow(
        expect.objectContaining({ name: "SyntaxError" })
      )
    }
  })

  it("should transform dynamic import in switch statements", () => {
    const code = [
      "(async () => {",
      '  switch (await import("a")) {',
      '    case await import("b"):',
      '      return await import ("c")',
      "  }",
      "})()"
    ].join("\n")

    for (const sourceType of sourceTypes) {
      const result = Compiler.compile(code, { sourceType })

      expect(result.code.includes("import")).toBe(false)
    }
  })

  it("should preserve line numbers", () => {
    const code = [
      "import",
      "",
      "a",
      "",
      'from "a"',
      "",
      "export",
      "",
      "default",
      "",
      "() =>",
      "//",
      "{",
      "b",
      "}"
    ].join("\n")

    for (const sourceType of modernTypes) {
      const result = Compiler.compile(code, { sourceType })
      const lines = result.code.split("\n")

      expect(lines[13]).toBe("b")
    }
  })

  it("should escape newlines in source specifiers", () => {
    for (const sourceType of modernTypes) {
      const result = Compiler.compile('import"\\n\\r\\u2028\\u2029"', { sourceType })

      expect(/[\n\r\u2028\u2029]/.test(result.code)).toBe(false)
    }
  })

  it("should preserve crlf newlines", () => {
    const code = ["import {", "  strictEqual,", "", "  deepEqual", "}", 'from "assert"'].join(
      "\r\n"
    )

    for (const sourceType of modernTypes) {
      const result = Compiler.compile(code, { sourceType })

      expect(result.code).toMatch(/(?:\r\n){5}$/)
    }
  })

  it("should not get confused by string literals", () => {
    const code = [
      "'a; import b from " + '"c"; d' + "'",
      '"a; import b " + ' + "'from " + '"c"; d' + "'"
    ].join("\n")

    for (const sourceType of sourceTypes) {
      const result = Compiler.compile(code, { sourceType })

      expect(result.code).toBe(code)
    }
  })

  it("should parse shorthand async function properties with reserved names", () => {
    for (const sourceType of sourceTypes) {
      expect(() => Compiler.compile("({ async delete() {} })", { sourceType })).not.toThrow()
    }
  })

  it("should parse arrow functions with destructured arguments", () => {
    const lines = ["({ a = 1 }) => {}", "({ a = 1 }, { b = 2 }) => {}"]

    for (const line of lines) {
      for (const sourceType of sourceTypes) {
        expect(() => Compiler.compile(line, { sourceType })).not.toThrow()
      }
    }
  })

  it("should parse transforms at the end of the source", () => {
    const lines = ['import { a } from "a"', 'import "a"', "let a; export { a }", "export default a"]

    for (const line of lines) {
      for (const sourceType of modernTypes) {
        expect(() => Compiler.compile(line, { sourceType })).not.toThrow()
      }
    }
  })

  it("should parse async generator syntax", () => {
    const code = [
      "export default async function * a() {}",
      "export const b = {",
      "  async *b() {}",
      "}",
      "export class C {",
      "  async *c() {}",
      "}"
    ].join("\n")

    for (const sourceType of modernTypes) {
      expect(() => Compiler.compile(code, { sourceType })).not.toThrow()
    }
  })

  it("should parse BigInt syntax", () => {
    const code = [
      "1n",
      "1234567890123456789n",
      "0b01n",
      "0B01n",
      "0xan",
      "0xAn",
      "0xfn",
      "0xFn",
      "0o01n",
      "0O01n"
    ].join("\n")

    for (const sourceType of sourceTypes) {
      expect(() => Compiler.compile(code, { sourceType })).not.toThrow()
    }
  })

  it("should parse numeric separator syntax", () => {
    const code = [
      "1_0",
      ".1_0e1_0",
      ".1_0E1_0",
      "0b0_1",
      "0B0_1",
      "0x0_a",
      "0x0_A",
      "0x0_f",
      "0x0_F",
      "0o0_1",
      "0O0_1"
    ].join("\n")

    for (const sourceType of sourceTypes) {
      expect(() => Compiler.compile(code, { sourceType })).not.toThrow()
    }
  })

  it("should parse BigInt and numeric separator syntax", () => {
    const code = [
      "1_0n",
      "0b0_1n",
      "0B0_1n",
      "0x0_an",
      "0x0_An",
      "0x0_fn",
      "0x0_Fn",
      "0o0_1n",
      "0O0_1n"
    ].join("\n")

    for (const sourceType of sourceTypes) {
      expect(() => Compiler.compile(code, { sourceType })).not.toThrow()
    }
  })

  it("should parse class fields syntax", () => {
    const code = [
      "export class A { a }",
      "export class B { [b] }",
      "export class C { static c }",
      "export class D { static [d] }",
      "export class E { #e }",
      "export class F { static #f }",
      "export class G { async }",
      "export class H { get }",
      "export class I { set }",
      "export class J { static }",
      "export class K {",
      "  a = 1",
      "  [b] = 1",
      "  static c = 1",
      "  static [d] = 1",
      "  static #e = 1",
      "  e() { this.#e }",
      "  static get f() {}",
      "  static set f(v) {}",
      "  static async g() {}",
      "  static *h() {}",
      "  static async *i() {}",
      "  [Symbol.iterator]() {}",
      "  async = 1;",
      "  get = 1",
      "  set = 1",
      "  static = 1",
      "  static async = 1;",
      "  static get = 1",
      "  static set = 1",
      "  static static = 1",
      "}"
    ].join("\n")

    for (const sourceType of modernTypes) {
      expect(() => Compiler.compile(code, { sourceType })).not.toThrow()
    }
  })

  it("should parse for-await-of syntax", () => {
    const code = [
      "export default async function convert(iterable) {",
      "  const result = []",
      "  for await (const value of iterable) {",
      "    result.push(value)",
      "  }",
      "  return result",
      "}"
    ].join("\n")

    for (const sourceType of modernTypes) {
      expect(() => Compiler.compile(code, { sourceType })).not.toThrow()
    }
  })

  it("should parse object rest/spread syntax", () => {
    const code = [
      'const ab = { a: "a", b: "b" }',
      'const abc = { ...K(ab), c: "c" }',
      "export const { a, ...bc } = abc",
      "export const d = ({ a, ...bcd } = {}) => bcd",
      "export default { ...abc, d }"
    ].join("\n")

    for (const sourceType of modernTypes) {
      expect(() => Compiler.compile(code, { sourceType })).not.toThrow()
    }
  })

  it("should transform `console` references and calls with identifier arguments", () => {
    const lines = [
      "console",
      "console.a(b)",
      'console.a("b", c)',
      'console["a"](b)',
      "new console.Console(a)",
      "class C extends console.Console {}",
      "const a = { console }",
      "const a = { [console]: console }",
      "const a = { console() { console } }",
      "const a = () => console"
    ]

    const compiled = [
      "_.g.console",
      "_.g.console.a(b)",
      '_.g.console.a("b", c)',
      '_.g.console["a"](b)',
      "new _.g.console.Console(a)",
      "class C extends _.g.console.Console {}",
      "const a = { console:_.g.console }",
      "const a = { [_.g.console]: _.g.console }",
      "const a = { console() { _.g.console } }",
      "const a = () => _.g.console"
    ]

    lines.forEach((line, index) => {
      const code = ['import a from "a"', line].join("\n")

      for (const sourceType of modernTypes) {
        const result = Compiler.compile(code, { sourceType })
        const actual = result.code.split("\n").pop()

        expect(actual).toBe(compiled[index])
      }
    })
  })

  it("should not transform other `console` use", () => {
    const lines = [
      "typeof console",
      "console.a('b')",
      "console.a(\"b\", 'c')",
      'console.a("b", `c`)'
    ]

    lines.forEach((line) => {
      const code = ['import a from "a"', line].join("\n")

      for (const sourceType of modernTypes) {
        const result = Compiler.compile(code, { sourceType })
        const actual = result.code.split("\n").pop()

        expect(actual).toBe(line)
      }
    })
  })

  it("should not transform `console` identifiers shadowed by arguments or variables", () => {
    const lines = ["let console = { a() {} }", "let a = (console) =>"]

    lines.forEach((line) => {
      const code = ['import a from "a"', "{", line, "console.a(b)", "}"].join("\n")

      for (const sourceType of modernTypes) {
        const result = Compiler.compile(code, { sourceType })

        expect(result.code.includes("_.g")).toBe(false)
      }
    })
  })

  it("should not transform `console` identifiers shadowed by `import` or `export` specifiers", () => {
    const lines = [
      'import console from "a"',
      'import * as console from "a"',
      "export let console = { a() {} }"
    ]

    lines.forEach((line) => {
      const code = [line, "console.a(b)"].join("\n")

      for (const sourceType of modernTypes) {
        const result = Compiler.compile(code, { sourceType })

        expect(result.code.includes("_.g")).toBe(false)
      }
    })
  })

  it("should wrap `eval()` use", () => {
    const lines = [
      "eval",
      "function a(b, c = 1, ...d) { return eval }",
      "const a = { eval }",
      "const a = { [eval]: eval }",
      "const a = { eval() { eval } }",
      "const a = () => eval",
      "a(eval, c)",
      "new eval.b.c()",
      "`eval ${ eval } eval`",
      "switch (eval) { case eval: eval }",
      "try {} catch { eval }"
    ]

    const compiledModule = [
      "_.e",
      "function a(b, c = 1, ...d) { return _.e }",
      "const a = { eval:_.e }",
      "const a = { [_.e]: _.e }",
      "const a = { eval() { _.e } }",
      "const a = () => _.e",
      "a(_.e, c)",
      "new _.e.b.c()",
      "`eval ${ _.e } eval`",
      "switch (_.e) { case _.e: _.e }",
      "try {} catch { _.e }"
    ]

    const compiledScript = [
      "(eval===_.v?_.e:eval)",
      "function a(b, c = 1, ...d) { return (eval===_.v?_.e:eval) }",
      "const a = { eval:(eval===_.v?_.e:eval) }",
      "const a = { [(eval===_.v?_.e:eval)]: (eval===_.v?_.e:eval) }",
      "const a = { eval() { (eval===_.v?_.e:eval) } }",
      "const a = () => (eval===_.v?_.e:eval)",
      "a((eval===_.v?_.e:eval), c)",
      "new (eval===_.v?_.e:eval).b.c()",
      "`eval ${ (eval===_.v?_.e:eval) } eval`",
      "switch ((eval===_.v?_.e:eval)) { case (eval===_.v?_.e:eval): (eval===_.v?_.e:eval) }",
      "try {} catch { (eval===_.v?_.e:eval) }"
    ]

    lines.forEach((line, index) => {
      const code = ["", line].join("\n")

      for (const sourceType of sourceTypes) {
        const result = Compiler.compile(code, { sourceType })
        const actual = result.code.split("\n").pop()
        const compiled = sourceType === SCRIPT ? compiledScript : compiledModule

        expect(actual).toBe(compiled[index])
      }
    })
  })

  it("should not wrap shadowed `eval()`", () => {
    const lines = [
      "function a(eval) { eval = eval }",
      "function a(...eval) { eval = eval }",
      "function a(eval = 1) { eval = eval }",
      "const a = { eval: 1 }",
      "const a = function eval() { eval = eval }",
      "try {} catch(eval) { eval = eval }",
      "eval: while (true) { break eval; continue eval }"
    ]

    for (const line of lines) {
      const result = Compiler.compile(line)

      expect(result.code).toBe(line)
    }
  })

  it("should not wrap `eval()` in `typeof` expressions", () => {
    const line = "typeof eval"

    const code = ["", line].join("\n")

    for (const sourceType of sourceTypes) {
      const result = Compiler.compile(code, { sourceType })
      const actual = result.code.split("\n").pop()

      expect(actual).toBe(line)
    }
  })

  it("should not wrap `eval()` in `with` statements", () => {
    const code = ["", "with (eval) { eval = eval }"].join("\n")

    const result = Compiler.compile(code)
    const actual = result.code.split("\n").pop()

    expect(actual).toBe("with ((eval===_.v?_.e:eval)) { eval = eval }")
  })

  it("should add TDZ asserts to bindings", () => {
    const lines = [
      "tdz",
      "function a(b, c = 1, ...d) { return tdz }",
      "const a = { tdz }",
      "const a = { [tdz]: tdz }",
      "const a = { tdz() { tdz } }",
      "const a = () => tdz",
      "a(tdz, c)",
      "new tdz.b.c()",
      "`tdz ${ tdz } tdz`",
      "switch (tdz) { case tdz: tdz }",
      "try {} catch { tdz }"
    ]

    const compiled = [
      '_.a("tdz",tdz)',
      'function a(b, c = 1, ...d) { return _.a("tdz",tdz) }',
      'const a = { tdz:_.a("tdz",tdz) }',
      'const a = { [_.a("tdz",tdz)]: _.a("tdz",tdz) }',
      'const a = { tdz() { _.a("tdz",tdz) } }',
      'const a = () => _.a("tdz",tdz)',
      'a(_.a("tdz",tdz), c)',
      'new (_.a("tdz",tdz)).b.c()',
      '`tdz ${ _.a("tdz",tdz) } tdz`',
      'switch (_.a("tdz",tdz)) { case _.a("tdz",tdz): _.a("tdz",tdz) }',
      'try {} catch { _.a("tdz",tdz) }'
    ]

    lines.forEach((line, index) => {
      const code = ['import tdz from "tdz"', line].join("\n")

      for (const sourceType of modernTypes) {
        const result = Compiler.compile(code, { sourceType })
        const actual = result.codeWithTDZ!.split("\n").pop()

        expect(actual).toBe(compiled[index])
      }
    })
  })

  it("should not add TDZ asserts to shadowed bindings", () => {
    const lines = [
      "function a(tdz) { tdz = tdz }",
      "function a(...tdz) { tdz = tdz }",
      "function a(tdz = 1) { tdz = tdz }",
      "const a = { tdz: 1 }",
      "const a = function tdz() { tdz = tdz }",
      "try {} catch(tdz) { tdz = tdz }",
      "tdz: while (true) { break tdz; continue tdz }"
    ]

    for (const line of lines) {
      const code = ['import tdz from "tdz"', line].join("\n")

      for (const sourceType of modernTypes) {
        const result = Compiler.compile(code, { sourceType })

        expect(result.codeWithTDZ).toBe(null)
      }
    }
  })

  it("should support V8 parse errors", () => {
    const options = { sourceType: MODULE }

    expect(() => Compiler.compile("a(", options)).toThrow(
      expect.objectContaining({
        name: "SyntaxError",
        message: expect.stringMatching(/Unexpected end of input/)
      })
    )

    expect(() => Compiler.compile("a(b c)", options)).toThrow(
      expect.objectContaining({
        name: "SyntaxError",
        message: expect.stringMatching(/missing \) after argument list/)
      })
    )

    expect(() => Compiler.compile("'", options)).toThrow(
      expect.objectContaining({
        name: "SyntaxError",
        message: expect.stringMatching(/Invalid or unexpected token/)
      })
    )

    expect(() => Compiler.compile("`a", options)).toThrow(
      expect.objectContaining({
        name: "SyntaxError",
        message: expect.stringMatching(/Unterminated template literal/)
      })
    )
  })

  it("should lexically scope top-level function declarations for MODULE", () => {
    const lines = ["var a; function a() {}", "function a() {}; var a"]

    const suffix = "; export {}"

    for (const sourceType of modernTypes) {
      for (const line of lines) {
        expect(() => Compiler.compile(line + suffix, { sourceType })).toThrow(
          expect.objectContaining({
            name: "SyntaxError",
            message: expect.stringMatching(/Identifier 'a' has already been declared/)
          })
        )
      }

      expect(() =>
        Compiler.compile("function a() { var b; function b() {} }" + suffix, { sourceType })
      ).not.toThrow()
    }
  })

  it("should not lexically scope top-level function declarations for SCRIPT", () => {
    const lines = ["var a; function a() {}", "function a() {}; var a"]

    const suffix = '; import("a")'

    for (const line of lines) {
      expect(() => Compiler.compile(line + suffix, { sourceType: SCRIPT })).not.toThrow()
    }
  })
})

describe("import assignment target early errors", () => {
  it("rejects assigning to import.meta and dynamic import expressions", () => {
    for (const target of ["import.meta", 'import("value")']) {
      for (const source of [
        `${target} = 1`,
        `${target} += 1`,
        `++${target}`,
        `${target}++`,
        `({ value: ${target} } = {})`,
        `[${target}] = []`,
        `for (${target} of []) {}`
      ]) {
        expect(
          () => Compiler.compile(source, { sourceType: MODULE }),
          `Expected a SyntaxError for: ${source}`
        ).toThrow(SyntaxError)
      }
    }
  })

  it("keeps property assignments to import.meta and import() results valid", () => {
    for (const source of ["import.meta.value = 1", 'import("value").result = 1']) {
      expect(() => Compiler.compile(source, { sourceType: MODULE }), source).not.toThrow()
    }
  })
})

describe("arbitrary module namespace names", () => {
  it("rejects string-literal local bindings even when the matching identifier exists", () => {
    for (const source of [
      'export { "foo" }; function foo() {}',
      'export { "foo" as "bar" }; function foo() {}'
    ]) {
      expect(() => Compiler.compile(source, { sourceType: MODULE })).toThrow(SyntaxError)
    }
  })

  it("preserves string-literal names in imports, re-exports, and namespace exports", () => {
    for (const name of ["☿", 'quoted"name', "slash\\name", "😀"]) {
      const moduleName = JSON.stringify(name)
      const importCalls: Array<[string, Array<[string, string[], unknown]>]> = []
      const importResult = Compiler.compile(`import { ${moduleName} as value } from "fixture"`, {
        sourceType: MODULE
      })

      new Function("_", importResult.code)({
        w(request: string, setters: Array<[string, string[], unknown]>) {
          importCalls.push([request, setters])
        }
      })
      expect(importCalls[0]![0]).toBe("fixture")
      expect(importCalls[0]![1][0]![0]).toBe(name)
      expect(importCalls[0]![1][0]![1][0]).toBe("value")

      const reExportCalls: Array<[string, Array<[string, string[], string[]]>]> = []
      const reExportResult = Compiler.compile(
        `export { ${moduleName} as ${moduleName} } from "fixture"`,
        { sourceType: MODULE }
      )

      new Function("_", reExportResult.code)({
        f(imported: string, exported: string) {
          return [imported, exported]
        },
        w(request: string, setters: Array<[string, string[], string[]]>) {
          reExportCalls.push([request, setters])
        }
      })
      expect(reExportCalls[0]![1][0]![0]).toBe(name)
      expect(reExportCalls[0]![1][0]![2][0]).toBe(name)
      expect(reExportCalls[0]![1][0]![2][1]).toBe(name)

      const namespaceCalls: Array<[string, Array<[string, string[], string[]]>]> = []
      const namespaceResult = Compiler.compile(`export * as ${moduleName} from "fixture"`, {
        sourceType: MODULE
      })

      new Function("_", namespaceResult.code)({
        f(imported: string, exported: string) {
          return [imported, exported]
        },
        w(request: string, setters: Array<[string, string[], string[]]>) {
          namespaceCalls.push([request, setters])
        }
      })
      expect(namespaceCalls[0]![1][0]![2][0]).toBe("*")
      expect(namespaceCalls[0]![1][0]![2][1]).toBe(name)

      const localExports: Array<[string, () => unknown]> = []
      const localExportResult = Compiler.compile(
        `const value = 42; export { value as ${moduleName} }`,
        { sourceType: MODULE }
      )

      new Function("_", localExportResult.code)({
        x(exports: Array<[string, () => unknown]>) {
          localExports.push(...exports)
        }
      })
      expect(localExports[0]![0]).toBe(name)
      expect(localExports[0]![1]()).toBe(42)
    }
  })

  it("rejects isolated surrogate code units in module export names", () => {
    for (const name of ['"\\uD83D"', '"\\uDC00"', '"\\uD83D_"']) {
      for (const source of [
        `export { value as ${name} }; const value = 1`,
        `export * as ${name} from "fixture"`,
        `import { ${name} as value } from "fixture"`
      ]) {
        expect(
          () => Compiler.compile(source, { sourceType: MODULE }),
          `Expected invalid module namespace name: ${source}`
        ).toThrow(SyntaxError)
      }
    }

    expect(() =>
      Compiler.compile('export { value as "\\uD83D\\uDE00" }; const value = 1', {
        sourceType: MODULE
      })
    ).not.toThrow()
  })
})

describe("static import attributes", () => {
  it("rejects duplicate attribute keys after normalizing string escapes", () => {
    for (const attributes of [
      'type: "json", "type": "json"',
      'type: "json", "typ\\u0065": "json"',
      '"__proto__": "json", "__proto__": "json"'
    ]) {
      for (const statement of [
        'import "fixture"',
        'import value from "fixture"',
        'import { value } from "fixture"',
        'import * as namespace from "fixture"',
        'export * from "fixture"',
        'export * as namespace from "fixture"',
        'export { value } from "fixture"'
      ]) {
        const source = `${statement} with { ${attributes} }`

        for (const sourceType of modernTypes) {
          expect(() => Compiler.compile(source, { sourceType }), source).toThrow(
            expect.objectContaining({
              name: "SyntaxError",
              message: expect.stringMatching(/Duplicate attribute key/)
            })
          )
        }
      }
    }
  })

  it("accepts empty and distinct import attributes in imports and re-exports", () => {
    for (const attributes of ["", 'type: "json", Type: "module"']) {
      for (const statement of [
        'import "fixture"',
        'import value from "fixture"',
        'import { value } from "fixture"',
        'export * from "fixture"',
        'export * as namespace from "fixture"',
        'export * as "custom name" from "fixture"',
        'export { value } from "fixture"'
      ]) {
        const source = `${statement} with { ${attributes} }`

        for (const sourceType of modernTypes) {
          expect(() => Compiler.compile(source, { sourceType }), source).not.toThrow()
        }
      }
    }
  })
})
