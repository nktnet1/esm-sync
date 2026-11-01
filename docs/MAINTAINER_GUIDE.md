# Maintainer guide

## Source and build boundaries

Use Node 24.14+ for development tooling, the pnpm version pinned in
`package.json`, matching Node headers, and a C++20 compiler for the native async
bridge. Install development dependencies and prepare fixtures before a local
build. The complete Docker driver handles those steps in containers.

Owned implementation and tooling live in `src/`, `script/src/`,
`test/harness/`, and `test/vitest/`. Generated bundles, declarations, native
binaries, and test workspaces belong under ignored `dist/`.

The package root remains CommonJS. Private ESM scopes cover `script/src/esm/`
and TypeScript tests; `.cts` identifies CommonJS helpers. Root `esm.js`/`index.js`
and their declarations forward to `dist/`. Public option types belong in
`src/types/public.ts`. Keep the public export aliases and physical entry paths.
`script/src/esm/outputs.ts` owns emitted helper paths and rewrites only helper
imports, never third-party fixtures. The strict/sloppy and equality transforms
in `config/babel.ts` remain necessary for the loader bundle.

## Verification

```sh
node script/src/esm/verify-all.ts
```

The standalone driver requires macOS or Linux, Node 24.14+, and a running Docker
daemon, including Docker Desktop on Apple Silicon. It uses Linux/amd64 images
for Node 22/24/26 and leaves the checkout's dependencies and build outputs alone.
It runs every Vitest project in both development and production, the complete
prepared Test262 selection in both modes, installed CJS/ESM consumers, release
builds, and startup/await workloads. Node 24 also runs lint, typechecking, Knip,
registry publish/install checks, and production/full dependency audits. The
existing host driver then runs its offline and online checks.

Stages run sequentially. A failed build blocks its dependent checks; independent
checks continue. Any failed, blocked, missing, stale, or inconsistent worker
result makes the run fail. Logs, incremental `steps.json`, Test262 results, and
`summary.json` go under `.cache/verification/run-*/`; `--reports <parent>` changes
the destination. Containers are removed after success or failure. Docker may
retain images/build caches for subsequent runs. Nothing publishes to npm.
Host-specific diagnostics also remain under `.cache/host-verification/`.

Original Babel and Log4brains applications require separately installed source
projects; their complete dependency graphs are not checked into this repository.
To include them, also prepare local development tooling and use:

```sh
pnpm verify:all --babel-project /path/to/babel-repro --log4brains-project /path/to/log4brains
```

Those optional checks prepare Acorn and build a local release before running
on the host. Local dependencies and a native build toolchain are required;
missing applications/dependencies or build failures make the run fail.
See [tooling verification](tooling-and-performance.md).
The default run does not certify those original applications. Linux containers
also do not replace macOS/Windows CI. Use `--help` for command syntax.

| Focused command                                     | Purpose                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm fixtures:prepare`                             | Prepare matching Acorn source and pinned Test262.                                   |
| `pnpm build --test` / `pnpm build --prod --test`    | Build development/production test bundles and native bridge.                        |
| `pnpm test:run` / `pnpm test:run:prod`              | Run every Vitest project against the corresponding existing build.                  |
| `pnpm test:conformance:run --report results.json`   | Run the separate Test262 selection after preparing/building.                        |
| `pnpm build:prod`                                   | Build the actual release artifact.                                                  |
| `pnpm test:packed --format=both`                    | Check installed CJS/ESM tarball consumers without install scripts.                  |
| `pnpm test:verdaccio`                               | Check disposable-registry publishing, installation, workers, and native rebuilding. |
| `pnpm lint` / `pnpm typecheck` / `pnpm lint:unused` | Check formatting, types including inferred `any`, and unused code.                  |
| `pnpm audit:prod` / `pnpm audit:all`                | Audit runtime-only and complete dependency trees.                                   |
| `pnpm verify:hosts:docker`                          | Run the [desktop/native/browser host checks](host-integrations.md).                 |

Do not rebuild while tests use the same `dist/` workspace. Keep case-specific
cache directories and order cold/warm trials. Canonicalise a temporary directory
with `fs.realpath` immediately after `mkdtemp`; for missing targets canonicalise
the existing parent. `path.resolve` does not resolve macOS `/tmp` aliases. Do not
weaken path equality assertions or skip platform cases to hide failures.

## Fixtures and evidence

Acorn vendor source must match the installed version; a generated parser stub
cannot validate a canonical build. Test262's revision and preparation checks
live in `script/src/setup-test262.ts`. Conformance distinguishes host-unsupported
features from passing cases and checks the expected error phase. Use
`--filter <path>` / `--limit <count>` only for focused diagnosis, not complete
verification. Fixture source, licences, and pinned byte checks remain intact;
`.gitattributes` prevents Windows checkout conversion of hashed originals.

`native-suites.test.ts` launches the compiled legacy harness in real Node
processes. Original-application verifiers and real-host checks provide different
evidence from synthetic tests. Keep their documented scope explicit.

## Runtime contracts

- Persistent compiler caches and evaluated module registries are separate.
  `ESM_DISABLE_CACHE=true`/`1` bypasses disk caches without flushing live modules.
  NYC uses a configuration-specific instrumentation namespace; changing its
  include/exclude rules must not reuse earlier instrumented output.
- CommonJS bytecode is captured after evaluation through `vm.Script`. Preserve
  source/error locations, accepted warm bytecode, cache repair, wrapper hooks,
  failed-load retries, and release of duplicate warm-cache text.
- Package `exports` and private `imports` select conditions in declaration order.
  Selected blocked, invalid, or missing targets are terminal. Arrays select
  valid mappings without probing file existence; path traversal and encoded
  separators remain rejected. Keep native Node comparison tests.
- Pseudo-ESM CommonJS with named exports may synthesise a missing default;
  marker-only `__esModule` namespaces remain empty. Explicit defaults survive.
- `.js` interop can participate in CommonJS mocking hooks. Strict `.mjs` graphs
  deliberately bypass them. Native await context/error contracts are documented
  in [async module loading](async-module-loading.md).
- Test fixture input belongs in JSON/files or process arguments, not interpolated
  JavaScript. Preserve hostile-input regressions without suppressing CodeQL.

## Global-reference rewriting

`src/visitor/globals.ts` routes selected unshadowed `console`/`Reflect`
references through the runtime global proxy. This provides namespace formatting,
inspector integration, and Reflect namespace-mutation behaviour while respecting
host global replacements and descriptors. Local bindings, `typeof`, property
names, strings, and comments retain their original meaning. Literal-only console
calls can avoid rewriting.

`src/visitor/undeclared.ts` separately guards absent CommonJS wrapper variables
when `cjs.vars` is disabled; an explicit `createRequire` binding remains local.
Keep the scope, shorthand, shadowing, and `typeof` compiler regressions. The
runtime proxy is internal and is not a public API.

## Dependencies and releases

`punycode` is the only declared production dependency; Acorn source is bundled.
Keep legacy development runners while they own real integration scenarios.
Review advisories before removing overrides from `pnpm-workspace.yaml`.
Generated lockfiles and build outputs do not belong in incremental patches.
See [releasing](../script/RELEASING.md) for tagged artifact verification and npm
Trusted Publishing.
