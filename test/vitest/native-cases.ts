import { readFileSync } from "node:fs"
import path from "node:path"
import { parse } from "acorn"
import { testPath } from "./helpers/run-node.ts"

export interface NativeCase {
  name: string
  location: string
  suites: string[]
}

type AstNode = {
  type: string
  name?: string
  object?: AstNode
  property?: AstNode
  loc?: { start: { line: number; column: number } }
  callee?: AstNode
  arguments?: AstNode[]
  argument?: AstNode
  consequent?: AstNode
  alternate?: AstNode
  operator?: string
  test?: AstNode
  value?: unknown
  [key: string]: unknown
}

export function location(line: number, column: number) {
  return `${line}:${column}`
}

function callName(node: AstNode | undefined): string | undefined {
  if (!node) return undefined

  if (node.type === "Identifier") {
    return node.name as string | undefined
  }

  if (node.type === "MemberExpression" && node.object?.name === "it") {
    return node.object.name
  }

  return undefined
}

// Native files use literal it()/it.skip() declarations. Read the test names
// without executing their loader-hook code inside Vitest's module graph.
export function collectNativeCases(filename: string, platform = process.platform): NativeCase[] {
  const source = readFileSync(path.join(testPath, filename), "utf8")
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true })
  const cases: NativeCase[] = []

  function walk(node: unknown, suites: string[]) {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) {
      for (const child of node as unknown[]) walk(child, suites)
      return
    }

    const current = node as AstNode
    if (current.type === "IfStatement") {
      // Platform-specific tests are registered only on the OS they exercise.
      // Match the same branch when discovering native cases for Vitest.
      const condition = current.test
      if (condition?.type === "Identifier" && condition.name === "isWin") {
        walk(platform === "win32" ? current.consequent : current.alternate, suites)
        return
      }
      if (
        condition?.type === "UnaryExpression" &&
        condition.operator === "!" &&
        condition.argument?.type === "Identifier" &&
        condition.argument.name === "isWin"
      ) {
        walk(platform !== "win32" ? current.consequent : current.alternate, suites)
        return
      }
    }
    if (current.type === "CallExpression") {
      const calleeName = callName(current.callee as AstNode)
      const loc = current.loc?.start
      if (calleeName === "it" && loc) {
        // node:test reports it.skip() at the method name, not at `it`.
        const testLoc =
          current.callee?.type === "MemberExpression"
            ? current.callee.property?.loc?.start || loc
            : loc
        const name = current.arguments?.[0]?.value
        if (typeof name !== "string") {
          throw new Error(`${filename}:${loc.line}: Native test names must be string literals`)
        }
        cases.push({ name, location: location(testLoc.line, testLoc.column + 1), suites })
      }

      if (calleeName === "describe" && loc) {
        // Include describe descendants, even if node:test skips the whole group.
        const nested = [...suites, location(loc.line, loc.column + 1)]
        for (const argument of current.arguments || []) walk(argument, nested)
        return
      }
    }

    for (const [key, value] of Object.entries(current)) {
      if (key !== "loc" && key !== "start" && key !== "end") walk(value, suites)
    }
  }

  walk(ast, [])
  if (cases.length === 0) throw new Error(`No native tests discovered in ${filename}`)
  return cases
}
