# TypeScript migration checkpoint

The maintained loader implementation, bootstrap, build tooling, native and
Test262 harnesses, and Vitest tests now use TypeScript. Published entry points
remain JavaScript with the existing CommonJS API and package paths.

| Source | Output / purpose |
| --- | --- |
| `src/**/*.ts` | Rspack/Babel loader and test bundles |
| `bootstrap/esm.ts`, `bootstrap/index.ts` | Public `esm.js`, `index.js` |
| `bootstrap/.ncurc.mts` | Maintenance configuration `.ncurc.mjs` |
| `tooling/**/*.ts`, `tooling/**/*.mts` | Checked commands emitted into `script/` |
| `harness/**/*.cts`, `harness/**/*.mts`, `harness/**/*.ts` | Native/CommonJS and Test262 entry points emitted into `test/` |
| `diagnostics/debug.ts` | `debug/debug.js` |
| `test/*.test.mts`, `test/vitest/**/*.mts` | Checked Vitest tests and helpers |

Historical JavaScript suites and consumer fixtures remain JavaScript because
their syntax, extensions, and CommonJS/ESM execution are compatibility-test
inputs. Native bridge/addon C and C++ and external vendor sources retain their
original languages.

## Building and checking

Use the existing pnpm commands. `tooling/cli.mts` uses Node's native TypeScript
support on the maintained development runtimes. It checks and emits tooling
before invoking a command. Build/test commands also check and emit the bootstrap
and harness. Generated output is ignored by Git. Build before directly invoking
generated `script/*.js` files or packing with lifecycle scripts disabled.

`pnpm typecheck` checks the implementation, tooling, bootstrap, harness, Vitest
tests, public declarations and their consumers, ts-node fixture, and separately
configured AVA/NYC/tsc fixture. It retains the installed TypeScript version check.
No dependency installation is needed to run those checks when dependencies and
vendor fixtures are already present.

All owned projects enable `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, and unknown catch variables. Library checking is
enabled. There are no explicit `any`, `@ts-ignore`, or `@ts-nocheck` escapes.
`tooling/check-type-safety.mts` additionally checks owned variables, parameters,
properties, bindings, returns, unions, and collection arguments for inferred
`any`. Unit tests verify rejection of leaks from `JSON.parse()` and `new Map()`
that TypeScript strict mode otherwise permits. Third-party APIs, including Node's
standard public `require` contract, retain their own declarations.

Private registry exports, shared state, module records, entry/getter/setter
metadata, compiler data, runtime methods, and AST visitors have concrete
contracts. Acorn's public node union is extended for the loader's syntax and
parser methods. Dynamic exports, reflection, VM results, and JSON cross through
`unknown` and are narrowed at their boundaries. Disk cache tuple records are
validated before use, and malformed records are recompiled.

Biome permits non-null assertions for existing initialization, checked-index,
and checked-map invariants. Strict null and indexed-access checking remain on.
It also permits `void` unions for visitor callbacks and the bootstrap's sloppy
`this` contract. Ordinary property reads preserve CommonJS getter errors and
primitive receivers, and the native Reflect object retains its identity.

Implementation imports retain `.js` specifiers. Rspack resolves them to owned
`.ts` files, strips types with its built-in SWC loader, and applies the existing
Babel transformations. The bootstrap retains sloppy execution so its initial
`this` lookup works when unsafe evaluation is blocked. Native harness dynamic
imports and async generators remain native because lowering them changes loader
and Node test-reporter behavior. Consumers do not need TypeScript.

The public declarations now include the existing `cache`, `debug`, and
`sourceMap` options. Package paths, dependencies, lockfiles, vendor sources,
native bridge implementation, and `README.md` are unchanged.

## Incremental verification

Before the last export-binding correction, the Node 24.21.0 Linux development
suite passed all 1,102 tests and production passed all 1,104 tests, including two
new type-safety gate cases. Packed CommonJS and CLI consumers passed on Node
22.23.4, 24.21.0, and 26.12.0.

The full pinned Test262 selection reported 1,745 passed, one failed, nine
unsupported, and no exclusions. Its remaining failure was a string literal used
as a local exported binding when a matching identifier existed. This checkpoint
explicitly rejects that invalid grammar in the parser and adds a compiler
regression. The visitor suspension-position regression found earlier during
migration is also fixed.

The saved checkpoint passes Biome, strict type checking and the inferred-`any`
audit, the production test build, all 51 focused compiler/type-safety tests, and
all 15 related `module-code/export-expname` Test262 cases with no exclusions.

The remaining validation checkpoint is a complete conformance rerun after this
correction, Node 22/26 production suites, and the performance comparison against
the exact v1.0.2 bundle. Those results are not claimed complete here. Existing
CI and pnpm roadmap items were confirmed by the user for v1.0.2.

The generated bootstrap and standalone bridge builder parse as ES2015. The
bundled Acorn source already contains nullish coalescing in the v1.0.2 baseline,
despite historical `node >=6` package metadata. This migration retains that
metadata and does not claim new Node 6 runtime verification.
