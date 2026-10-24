# TypeScript development and package compatibility

The maintained implementation, build tooling, bootstrap, native/Test262 suites,
Vitest tests, and diagnostic runner are TypeScript. Consumers continue to load
plain JavaScript through the existing CommonJS API and package paths.

## Module scopes and extensions

`.mts` is an explicit ESM marker, rather than a TypeScript requirement. Plain
`.ts` files use the nearest `package.json` to determine their module system.
Private development package scopes set `"type": "module"` in `tooling/esm/`,
`test/vitest/`, and `harness/`. Their ESM sources and imports now use `.ts`.

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
| `src/**/*.ts` | Rspack/Babel loader and test bundles |
| `bootstrap/esm.ts`, `bootstrap/index.ts` | Public `esm.js`, `index.js` |
| `tooling/esm/cli.ts` | Native TypeScript development entry point |
| `tooling/esm/ncurc.ts` | Maintenance configuration `.ncurc.mjs` |
| `tooling/**/*.ts` | JavaScript commands in `script/` |
| `harness/**/*.ts`, `harness/**/*.cts` | Native suites, helpers, reporters, and Test262 entry points in `test/` |
| `diagnostics/**/*.ts` | `debug/*.js` |
| `test/vitest/**/*.ts` | Vitest tests and helpers |

The remaining JavaScript under compatibility fixture directories is deliberate
loader input, including syntax errors, extension/goal checks, historical hosts,
and compiler-output snapshots. Native C/C++ and vendor sources retain their
original languages. The maintained native suites themselves now live in
`harness/`, including PM2 setup and process-list validation. The output snapshot
suite also migrated to TypeScript and is included in Vitest again.

## Checking and generation

`pnpm typecheck` uses `noEmit` throughout. It checks the implementation, tooling,
bootstrap, harness, unit tests, public declarations and consumers, ts-node input,
and separately configured AVA/NYC/tsc fixture. The installed TypeScript version is
checked directly from the native entry point. Checking neither creates nor
cleans `script/` and works when that directory is absent.

Build/test commands first run no-emit checks, then generate JavaScript separately.
They clear the disposable `script/` output directory before generation, removing
stale commands and declarations produced by the earlier emitter. They do not
emit `.d.ts` files. Tests obtain helper types directly from maintained TypeScript
sources. `index.d.ts`, source boundary declarations, and fixture contracts are
maintained declarations, rather than generated command output.

Use the existing pnpm commands. Build before invoking generated `script/*.js`
commands directly or packing with lifecycle scripts disabled. Consumers do not
need TypeScript. The standalone native bridge installer still emits CommonJS
JavaScript and has no dependency on development ESM scopes.

`tooling/esm/outputs.ts` lists native test output filenames. The emitter rewrites
owned helper imports to those destinations while leaving compatibility fixture
requests unchanged. Keeping `.mjs` output for helpers imported by strict `.mjs`
suites preserves the loader's extension checks. Rspack still strips source types
with its built-in SWC loader before applying the existing Babel transforms.

## Ignore rules

The additional rules cover generated output only: `script/`, public entry-point
files, maintenance configuration, diagnostic JavaScript, and the native test
files listed in the output manifest. Native test filenames are listed explicitly
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
enabled. The inferred-`any` audit in `tooling/esm/check-type-safety.ts` also checks
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

The module-scope and no-emit follow-up passes:

- Supplied Biome formatting/lint checks, strict no-emit checking, and the
  inferred-`any` audit. Checking also succeeds with `script/` absent and leaves it
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

Both checkouts used production test bundles on Node 24.21.0. The existing
`benchmark:await` runner alternated their process order and measured seven fresh
processes per case, with 5,000 cached loads each. Values below are medians;
shared-host scheduling and startup noise limit conclusions from this sample.

| Case | v1.0.2 cold ms | Current cold ms | v1.0.2 cached us/load | Current cached us/load |
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
