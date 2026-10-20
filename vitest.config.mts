import { defineConfig } from "vitest/config"

// Pure assertions run in Vitest. Loader-interception tests execute through
// test/vitest/native-suites.test.mts in real Node subprocesses.
export default defineConfig(({ mode }) => ({
  test: {
    include: ["test/*.test.mjs", "test/vitest/**/*.test.{mjs,mts}"],
    environment: "node",
    setupFiles: ["./test/vitest/setup.mts"],
    fsModuleCache: true,
    isolate: false,
    env: {
      ESM_SYNC_NODE_ENV: mode === "production" ? "production" : "development"
    },
    testTimeout: 30_000
  }
}))
