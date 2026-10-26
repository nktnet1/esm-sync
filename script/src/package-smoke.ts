import fs from "node:fs/promises"
import path from "node:path"
import execa from "execa"

export type ConsumerFormat = "cjs" | "esm"
export const compatibilityChecks = [
  { id: "native", label: "Native import(), require(), and createRequire()" },
  { id: "graphs", label: "Mixed CJS -> ESM -> CJS / ESM -> CJS -> ESM graphs" },
  { id: "boundaries", label: "Package type and .js/.cjs/.mjs boundaries" },
  { id: "conditions", label: "Node-native conditional import/require exports" },
  { id: "exports", label: "Published entry aliases via require() and import()" },
  { id: "cache", label: "Module identity, live bindings, and caches" },
  { id: "workers", label: "CommonJS and ESM worker threads" }
] as const

export type CompatibilityCheck = (typeof compatibilityChecks)[number]["id"]
export type SmokeCheck = ConsumerFormat | CompatibilityCheck | "preload"

export function consumerFormats(value: string): ConsumerFormat[] {
  if (value === "both") return ["cjs", "esm"]
  if (value === "cjs" || value === "esm") return [value]
  throw new Error("--format must be cjs, esm, or both")
}

export async function verifyInstalledFiles(consumerPath: string): Promise<void> {
  const installedPath = path.join(consumerPath, "node_modules/esm-sync")
  for (const filename of [
    "dist/index.js",
    "dist/esm.d.ts",
    "dist/index.d.ts",
    "dist/esm.js",
    "dist/esm/loader.js",
    "native/sync-await.cc",
    `dist/native/${process.platform}-${process.arch}-${process.versions.modules}.node`,
    "dist/script/build-sync-await.js"
  ]) {
    await fs.access(path.join(installedPath, filename))
  }
}

export async function runInstalledPackageCheck(
  consumerPath: string,
  format: ConsumerFormat,
  check: SmokeCheck,
  verbose = false,
  workerRounds = 1
): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" }
  for (const key of [
    "ESM_ENV",
    "ESM_OPTIONS",
    "ESM_DISABLE_CACHE",
    "ESM_SYNC_TEST_BUILD",
    "NODE_PATH",
    "NODE_OPTIONS"
  ])
    delete env[key]

  if (check === "workers") env.ESM_SYNC_SMOKE_WORKER_ROUNDS = String(workerRounds)

  const args =
    check === "preload"
      ? ["--require", "esm-sync", "cli.js"]
      : check === "cjs" || check === "esm"
        ? [format === "cjs" ? "consumer.cjs" : "consumer.mjs", check]
        : [format === "cjs" ? "compat.cjs" : "compat.mjs", check]
  if (check === "preload" && format !== "cjs")
    throw new Error("The CommonJS preload check requires a CommonJS project")

  // ESM consumers run native ESM, so the CommonJS preload hook is only
  // meaningful for a .js CLI inside the CommonJS consumer project.
  await execa(process.execPath, args, {
    cwd: consumerPath,
    env,
    extendEnv: false,
    stdio: verbose ? "inherit" : "pipe"
  })
}

export async function verifyInstalledPackage(
  consumerPath: string,
  formats: readonly ConsumerFormat[]
): Promise<void> {
  await verifyInstalledFiles(consumerPath)
  for (const format of formats) {
    for (const target of ["cjs", "esm"] as const) {
      await runInstalledPackageCheck(consumerPath, format, target)
      console.log(`${format.toUpperCase()} entry importing ${target.toUpperCase()} module: PASS`)
    }
    if (format === "cjs") {
      await runInstalledPackageCheck(consumerPath, format, "preload")
      console.log("CommonJS CLI preload: PASS")
    }
  }
}
