import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

export interface NodeResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

export const nodeEnv = process.env.ESM_SYNC_NODE_ENV || "development"
export const testEnvironments = [`${nodeEnv}-test`, `${nodeEnv}-test-cached`]
export const testPath = fileURLToPath(new URL("../../../dist/test/", import.meta.url))

// Each Vitest file uses a separate disk cache. Node subprocesses write cache
// metadata on exit, so sharing the default cache across parallel test files can
// leave inconsistent metadata for otherwise valid .mjs modules. The dedicated
// native cache tests still exercise the default cache without this override.
export function isolateLoaderCache(
  options: NodeJS.ProcessEnv,
  esmEnv: string,
  namespace: string
): NodeJS.ProcessEnv {
  const cache = path.join(testPath, "env/native-cache", esmEnv, `vitest-${namespace}`)
  const source = options.ESM_OPTIONS

  if (source === undefined) {
    return { ...options, ESM_OPTIONS: JSON.stringify({ cache }) }
  }

  // Honour tests that explicitly select or disable caching.
  if (/(?:^|[{,])\s*(?:cache|"cache"|'cache')\s*:/.test(source)) return options

  // Preserve JSON6 formatting: some cases deliberately check unquoted values.
  if (!/^\s*\{[\s\S]*\}\s*$/.test(source)) {
    throw new Error(`Expected object-literal ESM_OPTIONS for ${namespace}`)
  }

  // The legacy JSON6 fallback cannot reliably quote a bare `mode:all` when
  // the newly inserted string uses double quotes. Use a single-quoted value
  // instead, preserving the option syntax exercised by the fixture tests.
  const quotedCache = `'${cache.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`

  // Insert immediately after the first opening brace without rewriting nested
  // braces or string values. The object-literal check above guarantees it exists.
  const insertionIndex = source.indexOf("{") + 1

  return {
    ...options,
    ESM_OPTIONS: `${source.slice(0, insertionIndex)}cache:${quotedCache},${source.slice(insertionIndex)}`
  }
}

// Execute loader scenarios in native Node processes, never through Vite's transformer.
export function runNode(
  args: readonly string[],
  esmEnv: string,
  options: NodeJS.ProcessEnv = {},
  {
    timeout = 20_000,
    executable = process.execPath,
    cwd = testPath,
    cacheNamespace,
    input,
    keepStdinOpen = false
  }: {
    timeout?: number
    executable?: string
    cwd?: string
    cacheNamespace?: string
    input?: string
    keepStdinOpen?: boolean
  } = {}
): Promise<NodeResult> {
  return new Promise((resolve, reject) => {
    const effectiveOptions = cacheNamespace
      ? isolateLoaderCache(options, esmEnv, cacheNamespace)
      : options
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ESM_ENV: esmEnv,
      NODE_ENV: nodeEnv,
      NODE_OPTIONS: "--disable-warning=DEP0144",
      ...effectiveOptions
    }

    // A scenario without explicit options must not inherit a developer override.
    if (!Object.hasOwn(effectiveOptions, "ESM_OPTIONS")) {
      delete env.ESM_OPTIONS
    }

    // Vitest's worker markers do not belong in the tested application process.
    for (const key of Object.keys(env)) {
      if (key === "VITEST" || key.startsWith("VITEST_")) {
        delete env[key]
      }
    }

    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: "pipe",
      timeout
    })
    // An interactive Node REPL needs stdin to stay open until the test
    // fixture finishes its asynchronous evaluations and exits.
    if (keepStdinOpen) {
      if (input !== undefined) child.stdin.write(input)
    } else {
      child.stdin.end(input)
    }

    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (exitCode, signal) => {
      if (signal !== null) {
        reject(new Error(`Node CLI terminated with signal ${signal}: ${stderr.slice(-4_000)}`))
        return
      }

      resolve({ exitCode, stdout, stderr })
    })
  })
}
