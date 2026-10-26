const { configDefaults, defineConfig } = require("vitest/config") as typeof import("vitest/config")

const bootstrapTests = ["test/vitest/bootstrap-fixtures.test.ts"]

// Only library behaviour and platform-dependent integration checks run on
// the OS/Node matrix. Other tests (including new, unclassified tests) default
// to the Ubuntu/Node 24 tooling job, so adding a build test cannot silently
// multiply its CI cost ninefold.
const runtimeTests = [
  "async-contexts",
  "async-syntax",
  "builtin-modules",
  "cache-isolation",
  "check-hook",
  "cli-hook",
  "deferred-import",
  "eval-hook",
  "export-binding-identity",
  "main-hook",
  "native-suites",
  "repl-hook",
  "require-bindings",
  "resolution-safety",
  "test262-async-evaluation",
  "test262-async-followup",
  "test262-deferred-errors",
  "test262-fixture-loading",
  "test262-instantiation",
  "top-level-await"
].map((name) => `test/vitest/${name}.test.ts`)

// Loader-interception tests execute through native-suites.test.ts in real
// Node subprocesses, not Vite's module transformer.
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
          name: "runtime",
          include: runtimeTests,
          sequence: { groupOrder: 2 }
        }
      },
      {
        extends: true,
        test: {
          name: "tooling",
          include: ["test/vitest/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...bootstrapTests, ...runtimeTests],
          sequence: { groupOrder: 2 }
        }
      }
    ]
  }
}))
