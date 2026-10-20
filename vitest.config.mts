import { defineConfig } from "vitest/config"

// Only native-process-safe tests belong here. Loader-interception tests remain
// in the real-Node integration runner until they can be migrated safely.
export default defineConfig(({ mode }) => ({
  test: {
    include: ["test/vitest/**/*.test.{mjs,mts}"],
    environment: "node",
    fsModuleCache: true,
    isolate: false,
    // Native loader processes share a disk cache; keep test files sequential.
    fileParallelism: false,
    env: {
      ESM_SYNC_NODE_ENV: mode === "production" ? "production" : "development"
    },
    testTimeout: 30_000
  }
}))
