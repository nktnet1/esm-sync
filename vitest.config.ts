const { configDefaults, defineConfig } = require("vitest/config") as typeof import("vitest/config")

const bootstrapTests = ["test/vitest/bootstrap-fixtures.test.ts"]

// Pure assertions run in Vitest. Loader-interception tests execute through
// test/vitest/native-suites.test.ts in real Node subprocesses.
module.exports = defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    setupFiles: ["./test/vitest/setup.ts"],
    fsModuleCache: true,
    isolate: false,
    env: {
      ESM_SYNC_NODE_ENV: mode === "production" ? "production" : "development"
    },
    testTimeout: 30_000,
    // Cold TypeScript bootstrap checks must not compete with the native suites'
    // nested Node, Jest, AVA, and PM2 processes on smaller CI runners.
    projects: [
      {
        extends: true,
        test: {
          name: "bootstrap",
          include: bootstrapTests,
          isolate: true,
          fileParallelism: false,
          sequence: { groupOrder: 1 }
        }
      },
      {
        extends: true,
        test: {
          name: "main",
          include: ["test/vitest/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...bootstrapTests],
          sequence: { groupOrder: 2 }
        }
      }
    ]
  }
}))
