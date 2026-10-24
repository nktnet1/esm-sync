const { defineConfig } = require("vitest/config") as typeof import("vitest/config")

// Pure assertions run in Vitest. Loader-interception tests execute through
// test/vitest/native-suites.test.ts in real Node subprocesses.
module.exports = defineConfig(({ mode }) => ({
  test: {
    include: ["test/vitest/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./test/vitest/setup.ts"],
    fsModuleCache: true,
    isolate: false,
    env: {
      ESM_SYNC_NODE_ENV: mode === "production" ? "production" : "development"
    },
    testTimeout: 30_000
  }
}))
