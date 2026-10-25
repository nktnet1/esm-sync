# TypeScript development and package compatibility

The maintained implementation, build tooling, bootstrap, native/Test262 suites,
Vitest tests, and diagnostic runner are TypeScript. Consumers continue to load
plain JavaScript through the existing CommonJS API and package paths.

## Module scopes and extensions

`.mts` is an explicit ESM marker, rather than a TypeScript requirement. Plain
`.ts` files use the nearest `package.json` to determine their module system.
Private development package scopes set `"type": "module"` in `script/src/esm/`,
`test/vitest/`, and `test/harness/`. Their ESM sources and imports now use `.ts`.

The root package keeps its existing module format. Adding `"type": "module"`
there would reinterpret published `esm.js` and `index.js` as ESM and change
`require("esm-sync")`, direct entry-point requires, and CLI preloads. No published
ESM wrapper or new consumer API is needed. The root `vitest.config.ts` uses
CommonJS syntax and also supports Vite's native config loader.

Explicit `.cts` sources remain where CommonJS is part of the test protocol. Their
native dynamic imports must remain native, and the reporter must remain an async
generator. The output manifest preserves the legacy `.js`, `.mjs`, and `.cjs`
filenames independently of the TypeScript source layout.

| Source | Generated output / purpose |
| --- | --- |
| `src/**/*.ts` | tsdown loader and standalone test bundles, retaining the legacy Babel transforms |
| `src/bootstrap/esm.ts`, `src/bootstrap/index.ts` | tsdown CommonJS `esm.js`, `index.js` |
| `script/src/esm/cli.ts` | Native TypeScript development entry point |
| `config/ncurc.ts` | Maintenance configuration `.ncurc.mjs` |
| `script/src/build-sync-await.ts` | tsdown public installer and separate development bridge helper |
| `script/src/**/*.ts` | JavaScript commands in `script/` |
| `test/harness/**/*.ts`, `test/harness/**/*.cts` | Native suites, helpers, reporters, and Test262 entry points in `test/` |
| `debug/**/*.ts` | `debug/*.js` |
| `test/vitest/**/*.ts` | Vitest tests and helpers |

The remaining JavaScript under compatibility fixture directories is deliberate
loader input, including syntax errors, extension/goal checks, historical hosts,
and compiler-output snapshots. Native C/C++ and vendor sources retain their
original languages. The maintained native suites themselves now live in
`test/harness/`, including PM2 setup and process-list validation. The output snapshot
suite also migrated to TypeScript and is included in Vitest again.

## Repository layout and public entry points

The maintained source trees are `src/` (loader and public bootstrap), `script/src/`
(build and maintenance commands), `test/` (native harness, Vitest, compatibility
fixtures and consumer checks), `debug/`, `native/`, and `docs/`. The separate
root `bootstrap/`, `tooling/`, `harness/`, and `diagnostics/` directories are no
longer needed. `build/`, `esm/`, and `node_modules/` contain generated output or
installed dependencies.

tsdown owns emission of `esm.js`, `index.js`, and the standalone
`script/build-sync-await.js` from maintained TypeScript. The main configuration is
`tsdown.config.mts` at the root. Secondary TypeScript configurations and build
helpers live in `config/`, with a private ESM scope for native TypeScript loading.
Each entry is built independently with code splitting disabled. The public
entry sources use default exports that tsdown lowers to direct CommonJS exports.
The bootstrap's relative `require("./esm.js")` remains external.

Public entry code executes in the native CommonJS module context. Disabling the
output-level strict directive preserves the bootstrap's sloppy global-`this`
fallback when string code generation is disabled. There is no intermediate
CommonJS module wrapper or shared runtime chunk that could change
`module.filename`, `module.parent`, or require additional packaged files.
The loader, index, and standalone installer retain strict CommonJS output.
Loader host aliases are inserted after the directive so they cannot accidentally
disable strict execution.

The loader keeps its per-function Babel strict/sloppy transformations and Node 6
target. TypeScript erasure happens inside the tsdown source plugin, with shared
source transforms cached across the standalone entry builds. The same plugin
replaces Acorn's regular-expression implementation. Rolldown bundles the loader,
and Oxc handles the public bootstrap's TypeScript transformations. Production
output uses tsdown's native Oxc minifier with ES2015 compression and ASCII
output. The `__shared__` binding is reserved because the bootstrap supplies it
from outside the bundle. Publishing uses the same production build rather than
minifying its entry points a second time.

The build task owns cleanup; tsdown never cleans the repository root. Declaration
generation is disabled. Tests exercise the actual public output without
rewriting or restoring it. Public filenames, CommonJS entry points, and deep
requires remain compatible.

## Checking and generation

`pnpm typecheck` uses `noEmit` throughout. It checks the implementation, tooling,
bootstrap, harness, unit tests, public declarations and consumers, ts-node input,
and separately configured AVA/NYC/tsc fixture. The installed TypeScript version is
checked directly from the native entry point. Checking neither creates nor
cleans generated commands and works before any JavaScript output exists.

Build/test commands first run no-emit checks, then generate JavaScript separately.
They replace generated commands directly under `script/` and in `script/esm/`,
removing stale commands and declarations while preserving maintained `script/src/`
and the public installer. They do not emit `.d.ts` files. Tests obtain helper
types directly from maintained TypeScript sources. `index.d.ts`, source boundary declarations, and fixture contracts are
maintained declarations, rather than generated command output.

Use the existing pnpm commands. Build before invoking generated `script/*.js`
commands directly or packing with lifecycle scripts disabled. Consumers do not
need TypeScript. tsdown emits the public native bridge installer as CommonJS
JavaScript with no dependency on development ESM scopes. Preparation emits a separate
`script/build-sync-await-dev.js` so the bridge can be compiled before bundling.
It never creates, deletes, or overwrites the published `esm.js`, `index.js`,
or `script/build-sync-await.js`.

`script/src/esm/outputs.ts` lists native test output filenames. The emitter rewrites
owned helper imports to those destinations while leaving compatibility fixture
requests unchanged. Keeping `.mjs` output for helpers imported by strict `.mjs`
suites preserves the loader's extension checks. The tsdown source plugin strips
loader source types before applying the existing Babel transforms.

## Ignore rules

The additional rules cover generated output only: JavaScript and old declarations
directly under `script/`, `script/esm/`, public entry-point files, maintenance
configuration, diagnostic JavaScript, and the native test files listed in the output manifest. Native test filenames are listed explicitly
rather than ignoring the whole test tree. Previously tracked generated copies
are removed from Git's index so the rules actually take effect. Maintained
TypeScript directories are not ignored.

Existing rules for bundles, native binaries, vendor downloads, and test caches
are independent of this change. They keep reproducible build products and
runtime state out of source patches. Ignoring generated JavaScript does not stop
it from being included by the package's explicit `files` manifest after a build.

## Type safety

All owned projects enable `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, and unknown catch variables, with library checking
enabled. The inferred-`any` audit in `script/src/esm/check-type-safety.ts` also checks
owned declarations, returns, unions, and collection arguments. There are no
`@ts-ignore` or `@ts-nocheck` escapes. Native/import/eval and JSON boundaries expose
`unknown` or concrete fixture contracts. Negative-input tests use explicit erased
type assertions so their invalid runtime inputs remain intact.

The maintained Node-test contract permits completion values because the runtime
observes promise settlement and ignores those values. PM2 JSON results are
validated before accessing process fields. Standard third-party contracts,
including Node's public `require`, retain their own declarations. Existing
initialization and checked-index assertions remain explicit, with strict null
and indexed-access checks still enabled.

## Validation

### tsdown migration

The initial bundler migration used tsdown 0.23.2 with Babel and Terser
bundler plugins. The current build uses native minification as described above;
the following results record the original migration. Supplied Biome checks, strict no-emit checking,
and the inferred-`any` audit pass. Validation covers the supplied Node 22.23.4,
24.21.0, and 26.12.0 runtimes on Linux:

- All 30 Vitest files and 1,152 tests pass against production output on each
  runtime. Development output also passes the existing Node 22 suite.
- The full pinned Test262 selection passes on Node 24: 1,755 selected, 1,746
  passed, nine declared unsupported, zero failures, zero exclusions, and a
  complete report.
- Packed CommonJS consumers and CLI preloads pass on all three runtimes using
  pnpm 12.14.0. The package retains its existing public declaration, entry paths,
  loader, and standalone native bridge installer without development chunks.
- Rebuilding on the three runtimes produces byte-identical public JavaScript
  and loader output. Type-checking and test preparation preserve those bytes.
- New artifact checks require standalone test bundles and ES2015 JavaScript
  syntax, including effective strict directives in loader, index, and installer
  output. Public requires also run with string code generation disabled, in both
  cached and uncached test modes.

These are local Linux checks; fresh macOS and Windows CI results are not claimed.
The historical runtime engine metadata is retained, without claiming a new
Node 6 runtime verification.

### Consolidated layout and bundler emission

This follow-up passes supplied Biome checks, strict no-emit checking and the
inferred-`any` audit. All 28 Vitest files and 1,140 tests pass against the
production build on Node 24.21.0. Preparation and the production test runner
leave all three public generated assets byte-identical. Deleting those files
and rebuilding also regenerates all three byte-identically.
The 21 focused clean-checkout, type-safety and CLI-hook tests also pass on
Node 22/26, including checks that preparation emits the development bridge
helper without creating public entry files or generated declarations.

Packed CommonJS consumers, CLI preloads, direct entry-point requires and the
standalone installer export pass on Node 22.23.4/24.21.0/26.12.0. The Rspack
installer compiles the native bridge using supplied Node 22/26 headers. The
package contains the same 12 public/license/metadata/native files, without
maintained development sources, private ESM scopes or auxiliary entry chunks.
These checks ran on Linux; no new cross-platform CI result is claimed.

### Clean-checkout and resolution follow-up

Strict checking can run before vendor preparation. The Acorn boundary now
declares each of its eight side-effect-only parser modules explicitly, alongside
the existing typed value imports. No wildcard catch-all or compiler-check
suppression is needed. Builds still require the real downloaded sources.

The clean-checkout regression copies maintained sources without `src/vendor`,
generated commands, or bundles and runs the real fixture CLI against a local ZIP response.
It checks extraction and JavaScript-only generation, then verifies that a
missing owned side-effect import still fails with TS2882. A separate source-only
snapshot also passes aggregate checking before fixture preparation and builds
after extracting the real Acorn sources from a local archive.

The four supplied CodeQL annotations are addressed as follows:

- Path query/fragment removal finds the first delimiter with a single-character
  search and slices there. It handles line terminators without the previous
  backtracking suffix expression.
- Package export targets replace every wildcard using a callback, preserving
  literal `$&`, `$`-backtick, `$'`, `$$`, and `*` characters in captured subpaths.
  Captures propagate through conditions and array fallbacks, including patterns
  without suffixes. Exact keys require an exact match and take precedence over
  patterns. This remains the existing limited CommonJS exports fallback rather
  than a complete implementation of Node's package exports algorithm.
- The two percent-encoding test cases replace every `abc` occurrence.

Dedicated resolution tests cover these cases and long multiline suffixes with
200,000 delimiters in bounded native Node processes. This follow-up passes
Biome, strict no-emit checking, and the inferred-`any` audit. All 28 Vitest files
and 1,140 tests pass on Node 24.21.0 in development and production. The 15 focused
src/bootstrap/resolution tests pass on Node 22.23.4/24.21.0/26.12.0, and the 14
resolution tests also pass against production bundles on Node 22/26. These new
checks ran on Linux. The offline bootstrap test gives its child processes a
separate bounded budget for checking several TypeScript projects on busy runners.
The CodeQL CLI is unavailable locally, so a fresh CodeQL scan is not claimed.

### Module-scope and no-emit follow-up

The v1.0.4 module-scope and no-emit follow-up passes:

- Supplied Biome formatting/lint checks, strict no-emit checking, and the
  inferred-`any` audit. Checking also succeeds before generated commands exist and leaves them
  absent; generated commands contain no declaration files after a build.
- All 26 Vitest files and 1,125 tests on Linux: Node 24.21.0 in development and
  Node 22.23.4/24.21.0/26.12.0 in production. These include the 20 restored compiler-output
  snapshot tests and all native suites. Node 22 also loads `vitest.config.ts`
  through Vite's native config loader.
- The production test cleanup preserves generated native suites, maintenance
  configuration, and diagnostic modules alongside the loader and tooling.
- The full pinned Test262 selection on Node 24.21.0 with the production bundle:
  1,755 selected, 1,746 passed, nine explicitly unsupported, zero failures, zero
  exclusions, and a complete report.
- Packed CommonJS consumers, direct `esm.js`/`index.js` requires, and CLI preloads
  on Node 22/24/26. The packed file list retains the public declaration and
  standalone bridge installer and excludes development package scopes.

The user confirmed the existing cross-platform CI and pnpm roadmap items for
v1.0.2. These new runtime checks ran on Linux. Dependencies, lockfiles, vendor
sources, native bridge implementation, and `README.md` are unchanged.

### Benchmark against v1.0.2

The v1.0.2 and v1.0.4 checkouts used production test bundles on Node 24.21.0. The existing
`benchmark:await` runner alternated their process order and measured seven fresh
processes per case, with 5,000 cached loads each. Values below are medians;
shared-host scheduling and startup noise limit conclusions from this sample.

| Case | v1.0.2 cold ms | v1.0.4 cold ms | v1.0.2 cached us/load | v1.0.4 cached us/load |
| --- | ---: | ---: | ---: | ---: |
| Synchronous module | 11.769 | 11.401 | 6.333 | 5.856 |
| Synchronous graph | 13.157 | 14.401 | 6.175 | 5.715 |
| Synchronous chain | 24.588 | 25.768 | 5.861 | 5.144 |
| Microtask await | 12.423 | 12.056 | 6.171 | 5.639 |
| Transitive await | 14.555 | 14.101 | 6.488 | 5.465 |
| Timer await | 15.202 | 14.598 | 6.071 | 5.212 |

All cases completed successfully. Cached medians were lower in this sample;
the two synchronous graph cold medians were higher by 1.244 and 1.180 ms.
These measurements do not establish a general performance improvement.

The historical `node >=6` package metadata is retained. The v1.0.2 bundled Acorn
already contains nullish-coalescing syntax, despite Babel's Node 6 target. The
public bootstrap and standalone bridge builder retain ES2015 syntax. A new Node 6
runtime verification is not claimed.
