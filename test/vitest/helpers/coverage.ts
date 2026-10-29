import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runNode, testPath } from "./run-node.ts"

const require = createRequire(import.meta.url)
export const coverageLoader = path.resolve(testPath, "../esm.js")
export const nycCLI = require.resolve("nyc/bin/nyc.js")
export const tsNodeRegister = require.resolve("ts-node/register")
export const mochaCLI = require.resolve("mocha/bin/_mocha")
export const proxyquirePath = require.resolve("proxyquire")
export const babelRegister = require.resolve("@babel/register")
export const babelPreset = require.resolve("@babel/preset-env")

export interface FileCoverage {
  path: string
  fnMap: Record<string, { name: string; loc: { start: { line: number } } }>
  f: Record<string, number>
  branchMap: Record<string, { type: string; line: number }>
  b: Record<string, number[]>
  statementMap: Record<string, { start: { line: number } }>
  s: Record<string, number>
}

// Istanbul source-map remapping may spell the same file with forward slashes,
// a different drive-letter case, or a file URL on Windows. Compare actual
// filesystem identities, not JSON object keys; never accept a non-existent
// source or coverage belonging to a different file.
export async function coverageFor(
  coverage: Record<string, FileCoverage>,
  filename: string
): Promise<FileCoverage> {
  const expected = await realpath(filename)
  for (const [reportedPath, file] of Object.entries(coverage)) {
    let candidate: string
    try {
      candidate = reportedPath.startsWith("file:")
        ? fileURLToPath(reportedPath)
        : path.resolve(path.dirname(expected), reportedPath)
    } catch {
      continue
    }
    const actual = await realpath(candidate).catch(() => undefined)
    if (actual === expected) return file
  }
  throw new Error(
    `NYC did not report coverage for ${expected}; reported paths: ${JSON.stringify(Object.keys(coverage))}`
  )
}

export async function withCompatibilityFiles(
  files: Record<string, string>,
  run: (directory: string) => Promise<void>
): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-sync-tooling-")))
  try {
    for (const [name, source] of Object.entries(files)) {
      const filename = path.join(directory, name)
      await mkdir(path.dirname(filename), { recursive: true })
      await writeFile(filename, source)
    }
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function runCoverage(
  directory: string,
  esmEnv: string,
  {
    entry = "index.js",
    include = "math.js",
    report = "coverage",
    preloads = [coverageLoader],
    args = [],
    env = {}
  }: {
    entry?: string
    include?: string
    report?: string
    preloads?: string[]
    args?: string[]
    env?: NodeJS.ProcessEnv
  } = {}
) {
  const result = await runNode(
    [
      nycCLI,
      "--cwd",
      directory,
      "--temp-dir",
      path.join(directory, report + "-raw"),
      "--report-dir",
      path.join(directory, report),
      "--reporter=json",
      "--cache=false",
      "--include",
      include,
      ...preloads.flatMap((filename) => ["--require", filename]),
      process.execPath,
      entry,
      ...args
    ],
    esmEnv,
    { ESM_OPTIONS: "{cjs:true,mode:'auto',cache:'./esm-cache'}", ...env },
    { cwd: directory, timeout: 90_000 }
  )
  let coverage: Record<string, FileCoverage> = {}
  try {
    coverage = JSON.parse(
      await readFile(path.join(directory, report, "coverage-final.json"), "utf8")
    ) as Record<string, FileCoverage>
  } catch (error) {
    if (result.exitCode === 0) throw error
  }
  return { ...result, coverage }
}
