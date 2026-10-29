# Maintainer guide

This is the condensed reference for building, testing, and maintaining
`esm-sync`. Public usage and options belong in [`README.md`](../README.md).
Synchronous top-level-await limitations belong in
[async-module-loading.md](async-module-loading.md). Current upstream follow-ups
and their real-application evidence are in the
[roadmap](FORK_ISSUES_ROADMAP.md) and
[tooling/performance notes](tooling-and-performance.md).

For default-export unwrapping, Mocha setup, and migrating a consumer to native
Node ESM, see [interoperability and migration](interop-and-migration.md).

Ask for explicit approval before making further changes to `README.md`.
Keep upstream issue references out of headings and include the full URL as
link text in the description. Avoid semicolons in Markdown prose.

## Source, build outputs, and module boundaries

- Maintained sources: `src/`, `script/src/`, `config/`, `native/`, `test/`, and the root entry-point shims. Generated bundles, declarations, native add-ons, and test workspaces live under ignored `dist/`. Do not commit them.
- The package root remains **CommonJS** for `require("esm-sync")`, CLI preload, and direct entry paths. `script/src/esm/` and the TypeScript test harnesses have private ESM scopes. `.cts` explicitly marks CommonJS helpers. JavaScript compatibility fixtures remain JavaScript on purpose.
- Root `esm.js`/`index.js` and their `.d.ts` files forward legacy paths to `dist/`. `tsdown.config.mts` emits CommonJS entries and public types, bundles `src/index.ts` into `dist/esm/loader.js`, and supplies the package export aliases. The loader's Babel strict/sloppy and equality transforms are required even though production minification uses Oxc.
- `src/types/public.ts` owns public option types. `pnpm typecheck` checks owned TypeScript and inferred `any` without emitting files. Do not change the root module type or remove public alias paths to simplify a build.
- `script/src/esm/outputs.ts` owns emitted fixture-helper filenames. It rewrites only its own helper imports, never third-party fixtures. The native async bridge is built from `native/sync-await.cc` and published as a platform/architecture/Node-ABI-specific binary. See [async module loading](async-module-loading.md) for installation restrictions.

| Command                                                                        | Purpose                                                                                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `pnpm fixtures:acorn`                                                          | Prepare matching Acorn source files                                                    |
| `pnpm fixtures:prepare`                                                        | Prepare Acorn and pinned Test262                                                       |
| `pnpm build:prod`                                                              | Generate release artifacts                                                             |
| `pnpm build --prod --test`                                                     | Generate production-test runtime and fixture bundles                                   |
| `pnpm typecheck`                                                               | Check TypeScript without writing outputs                                               |
| `pnpm test:run:prod`                                                           | Test an existing production-test build                                                 |
| `pnpm test:prod`                                                               | Prepare fixtures, build and test production output                                     |
| `pnpm test:conformance`                                                        | Run the separate Test262 conformance selection                                         |
| `pnpm test:packed --format=both`                                               | Check an installed tarball without running install scripts                             |
| `pnpm test:verdaccio`                                                          | Publish to a disposable local registry and test CJS/ESM consumers and native installer |
| `pnpm verify:babel-repro --project=/path/to/repro`                             | Verify the installed original Babel application without changing its files             |
| `pnpm benchmark:log4brains --project=/path/to/log4brains --node=/path/to/node` | Compare original `esm` and the current release artifact with private caches            |

Persistent CommonJS bytecode uses `vm.Script.createCachedData` after module
execution so initialised helper functions can be reused on later starts. The
wrapper occupies a separate line with `lineOffset: -1` to preserve user-source
runtime columns and syntax-error snippets. Old function bytecode is rejected and
repaired on upgrade. Keep cold/warm cache, wrapper-hook, error-location, and
failed-load/retry regressions when changing this path. See the
[current latency and memory measurements](tooling-and-performance.md#lower-startup-memory-v1012).

Accepted bytecode needs no exit-time cache work: keep Script objects only for
misses and rejected bytecode. Mixed warm/missing entries must retain the older
valid bytecode when a cache is rewritten. After accepted warm CommonJS
bytecode executes, release the duplicate raw text held by the entry/compiler
cache. Keep cold compilation and bytecode capture unchanged. Transformed
CommonJS and ESM sources remain available for source-cache writes and linking.

`pnpm test:verdaccio` needs registry access. It exercises separate CJS/ESM
consumer projects, exported paths, native bridge rebuilding, and workers.
The normal Vitest suite does not replace this installed-package verification.

## Test fixtures and regression standards

- Acorn vendor **source**, not just the installed npm package, must match the installed Acorn version. The uploaded offline fixture includes `src/vendor/acorn/acorn/package.json` and `src/state.js` for Acorn **8.19.0**. The normal fixture preparation checks them. Do not substitute a generated stub when validating the canonical build.
- Test262 is pinned in `script/src/setup-test262.ts` at `d53ebc8b1931d9f1541e43d59650776e4b766248`. Conformance tests run in separate processes and distinguish _unsupported_ host features from passing cases and failing error phases. Use `pnpm test:conformance:run --filter <path> --limit <count> --report <file>` for narrower checks. Do not weaken those assertions.
- `test/vitest/native-suites.test.ts` covers the compiled Node harness, including cache variants. `test/vitest/tooling-original-reproductions.test.ts` and `test/vitest/fork-tooling-performance.test.ts` exercise actual integration hooks in subprocesses. Synthetic regressions alone cannot prove that the original Babel or Log4brains application works.
- `verify:babel-repro` copies the original Babel source/configuration byte-for-byte into private workspaces and shares only installed dependencies. It observes the database's actual two-second timer and checks completion and single evaluation before `listen()`, then verifies the HTTP response. Every physical entry and preload order runs with disabled, cold, and warm bootstrap/compiler/Babel caches. `--node=/path/to/node` selects the application runtime. Timer awaits require its matching native bridge.
- Build with `pnpm build:prod` before `benchmark:log4brains`. `--workload=version` measures terminating CLI startup. `--workload=preview` measures a complete HTTP 200 response from the child's own ephemeral port. The benchmark redirects the original CLI's `require("esm")` and supplies only a private cache path to its factory. It alternates loader order, checks cold/warm cache state and identical output, and records resource usage and artifact hashes. `--profile-dir=/path/to/profiles` enables CPU profiles. Keep those runs separate from ordinary timing trials. Neither command installs dependencies.
- Keep isolation between concurrent tests and separate cache directories for each case. Within each case, cold/warm runs are ordered. The native harness limits concurrent subprocesses. Do not skip existing Windows/macOS cases to conceal platform defects.
- When asserting canonical resolver paths, resolve existing paths with `fs.realpath` / `fs.realpathSync`. Canonicalise the temporary directory immediately after `mkdtemp`. For a missing target, canonicalise its existing parent. macOS `/tmp` versus `/private/tmp` is a real alias and `path.resolve` does not normalise it.
- Source-phase imports and immutable byte imports are host-capability dependent. Report unsupported cases honestly. `.mjs` import graphs deliberately bypass `Module._load` mocking hooks.

## Compilation caches, coverage, and mocking

| Setting                         | Meaning                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `cache: false`                  | Disable persistent compilation for this configuration                         |
| `cache: "directory"`            | Select compiler-cache location                                                |
| `cjs.cache: true`               | Expose eligible `.js` module records in CommonJS cache                        |
| `ESM_DISABLE_CACHE=true` or `1` | Bypass disk compiler/bootstrap reads and writes. Do not delete existing cache |

Set `ESM_DISABLE_CACHE` before loading the package. `false`, `0`, and invalid
JSON do not disable caching. A disabled **compiler** cache does not flush an
already evaluated module graph. For re-evaluation use a fresh process, worker,
or an explicitly managed module registry. Deleting files from a compiler cache
is not automatic hot reload.

NYC and other register hooks run before compilation. NYC's instrumented cache
uses its own `nyc-<hash>` namespace keyed by coverage configuration. `nyc
--cache=false` and `ESM_DISABLE_CACHE` control different layers. Changing
coverage include/exclude rules must not reuse earlier instrumentation.

CommonJS mock libraries such as proxyquire intercept `.js` interop graphs by
importer, before the real dependency runs. Strict `.mjs` dependency graphs
bypass CommonJS mocking, although a top-level `require()` may be intercepted
before reaching the loader. Keep tests for cache resets, stubs, and instrumented
transforms.

## Package resolution and legacy interop

Package `exports` takes precedence over `main` and `mainFields`. Import and
require conditions are selected separately in declaration order. No fallback
to private files or other conditions is allowed after a blocked, missing, or
invalid selected target. Exact subpaths precede patterns, the most specific
pattern wins, and path traversal or encoded separators are rejected. Targets
are exact files (including `.cjs`). Arrays choose the first valid matching
target without checking file existence. Supported conditions include `node`,
`default`, host `module-sync` / `node-addons`, and custom `--conditions` values.
The historical `"./": "./dist/"` folder map remains supported for Node 13
compatibility alongside modern patterns.

For pseudo-ESM CommonJS exports marked `__esModule`, an absent `default` is
synthesised from `module.exports` **only when another export is present**.
Marker-only namespaces remain empty. Explicit defaults are preserved. This
v1.0.6/v1.0.7 contract protects both Log4brains' `tslib@2.2.0` and the
native import suite.

## Global-reference rewriting

Upstream report: [https://github.com/standard-things/esm/issues/865](https://github.com/standard-things/esm/issues/865).

The user-source compiler routes selected unshadowed `console` and `Reflect`
references through the loader runtime when transforming static or dynamic
imports. In generated code, `_.g` is the runtime's global proxy. `_` is the
schematic runtime identifier used below, not an application variable or public
API. The generated name can differ.

```js
// Source, in a module containing an import:
console.log(value)
Reflect.set(target, "key", value)
const context = { console }

// Corresponding expressions after compilation:
_.g.console.log(value)
_.g.Reflect.set(target, "key", value)
const context = { console: _.g.console }
```

This lets the loader's console format its emulated namespace objects and
connect to the host inspector. Its Reflect wrappers handle namespace mutation
operations (`defineProperty`, `deleteProperty`, and `set`), returning `false`
for rejected namespace operations while preserving errors for other targets.
The global proxy respects replacements of host globals and property descriptor
constraints. Reflect polyfill additions, replacements, and deletions remain
shared with CommonJS.

The transform is selective. It preserves local bindings, including function
parameters and imported `console`/`Reflect` names, and does not rewrite property
names, comments, or strings. `typeof console` and `typeof Reflect` remain
unchanged. Direct console member calls with no arguments or only literal or
template-literal arguments are skipped. `console.log(value)` is rewritten.
For example, `import console from "node:console"` creates a local binding and
skips this prefixing. That import still follows the loader's builtin-module
handling.

A separate transform enforces the absence of CommonJS wrapper locals in ESM
when `cjs.vars` is disabled. Unbound `require` becomes `_.t("require")`, which
checks the actual global and throws if absent. `typeof require` becomes
`typeof _.g.require`, preserving its non-throwing lookup. The same handling
applies to `__dirname`, `__filename`, `arguments`, `exports`, and `module`.
Explicit local bindings, including a `require` created with `createRequire`,
remain local. This is not a blanket rewrite of globals such as `process` or
`Buffer`.

Start with [the compiler](../src/compiler.ts),
[the globals visitor](../src/visitor/globals.ts), and
[the undeclared-variable visitor](../src/visitor/undeclared.ts). Runtime aliases
are in [runtime.ts](../src/runtime.ts). Proxy and wrapper behaviour is in
[global.ts](../src/builtin/global.ts), [console.ts](../src/builtin/console.ts),
and [reflect.ts](../src/builtin/reflect.ts). Keep the scope, shorthand,
`typeof`, and shadowing cases in [the compiler tests](../test/vitest/compiler.test.ts)
when changing this code. The strict/sloppy and equality build transforms in
[config/babel.ts](../config/babel.ts) act on the loader's own bundle and are a
separate compilation stage.

## Dependency policy

`punycode` is the only declared production dependency. Runtime Acorn source
is bundled. Keep external test runners (Jest 26, NYC, AVA, Mocha, Jasmine,
Lab, Babel hooks, ts-node, Webpack, etc.) when they own passing integration
scenarios, even if the runtime bundle does not directly import them.
`pnpm-workspace.yaml` holds security overrides for legacy dependencies. Review
advisories before changing/removing overrides. `pnpm audit:prod`,
`pnpm audit:all`, and `pnpm lint:unused` are separate checks. Maintain the
lockfile locally if dependencies change, but **do not include generated
`pnpm-lock.yaml` in incremental patches**.
