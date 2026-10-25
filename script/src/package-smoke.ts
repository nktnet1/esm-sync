import fs from "node:fs/promises"
import path from "node:path"
import execa from "execa"

export type ConsumerFormat = "cjs" | "esm"

export function consumerFormats(value: string): ConsumerFormat[] {
  if (value === "both") return ["cjs", "esm"]
  if (value === "cjs" || value === "esm") return [value]
  throw new Error("--format must be cjs, esm, or both")
}

export async function verifyInstalledPackage(
  consumerPath: string,
  formats: readonly ConsumerFormat[]
): Promise<void> {
  const installedPath = path.join(consumerPath, "node_modules/esm-sync")
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
  for (const filename of [
    "dist/index.js",
    "index.d.ts",
    "dist/esm.js",
    "dist/esm/loader.js",
    "native/sync-await.cc",
    `dist/native/${process.platform}-${process.arch}-${process.versions.modules}.node`,
    "dist/script/build-sync-await.js"
  ]) {
    await fs.access(path.join(installedPath, filename))
  }

  for (const format of formats) {
    await execa(process.execPath, [format === "cjs" ? "consumer.cjs" : "consumer.mjs"], {
      cwd: consumerPath,
      env,
      extendEnv: false,
      stdio: "inherit"
    })
  }

  await execa(process.execPath, ["--require", "esm-sync", "cli.js"], {
    cwd: consumerPath,
    env,
    extendEnv: false,
    stdio: "inherit"
  })
}
