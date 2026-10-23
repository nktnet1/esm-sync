# Modernisation roadmap

Modernise `esm-sync` for Node.js 26, replace the development toolchain, and remove
superseded dependencies and configuration. Keep the published CommonJS loader's
observable behaviour intact unless an intentional breaking change is documented.

## Target stack

| Area | Current | Target |
| --- | --- | --- |
| Runtime | Node.js `>=6`; CI on 22/24/26 | Validate 26, retain 24, keep 22 CI |
| Package manager | pnpm 11 | pnpm 12 |
| Git hooks | Husky | Lefthook |
| Type checking | TypeScript 4.9 | TypeScript 6.0.3; 7.1+ deferred |
| Linting and formatting | ESLint 7 | Biome 2 |
| Tests | Mocha-based internal runner | Vitest + real Node.js integration tests |
| Bundling | Rspack + webpack-compatible plugins | tsdown (Rolldown) |
| Source transformation | Babel + custom plugins | Oxc via tsdown; source refactors where needed |

**Babel will be removed entirely.** tsdown already uses Oxc for supported
syntax transformations, so no separate transpiler needs to be introduced.

## Execution order (least work to most work)

Estimates are rough engineering days, assuming the existing test baseline is
available. Later phases have substantially more compatibility risk. Each phase
should be a separate, reviewable patch and remove its superseded tooling.

| Order | Migration | Estimate | Completion gate |
| --- | --- | --- | --- |
| 1 | Husky to Lefthook | 0.5 day | Hooks work; Husky is removed |
| 2 | pnpm 11 to 12 | 0.5-1 day | Reproducible installs and CI |
| 3 | TypeScript 4.9 to 6 | 1-2 days | TypeScript 6 type checks; compiler API retained |
| 4 | Dependency and CI hygiene | 1-3 days | Supported dependencies; clean CI |
| 5 | ESLint to Biome | 2-4 days | Biome is the only main linter/formatter |
| 6 | Node.js 26 support | 2-6 days | Loader and packed package pass on 26 |
| 7 | Mocha to Vitest | 3-8 days | Equivalent unit and integration coverage |
| 8 | Rspack/Babel to tsdown/Oxc | 5-15 days | Equivalent bundles; old build stack removed |

### 1. Replace Husky with Lefthook

- [x] Add `lefthook.yml` with fast staged-file checks; leave full tests to CI.
- [x] Update `prepare` and any setup instructions for Lefthook.
- [x] Remove `.husky/`, `.huskyrc.js`, the `husky` dependency, and its pnpm build approval.
- [ ] Confirm hooks install, execute, fail on violations, and work from a clean clone.

### 2. Upgrade to pnpm 12

- [x] Pin pnpm 12.14.0 in `packageManager` and use `pnpm/setup` in CI.
- [x] Review `pnpm-workspace.yaml`: existing `allowBuilds` entries work with
      pnpm 12; keep security overrides pending the dependency audit in phase 4.
- [ ] Regenerate and commit `pnpm-lock.yaml` with pnpm 12. Generated lockfiles
      are deliberately excluded from incremental patches.
- [ ] Switch CI from temporary `--no-frozen-lockfile` to `--frozen-lockfile` once
      the updated lockfile is committed. Verify clean installs, Lefthook's
      lifecycle script, and package publishing dry runs.
- [ ] Remove unnecessary overrides after the dependency audit in phase 4.

### 3. Upgrade to TypeScript 6; defer TypeScript 7

- [x] Upgrade to TypeScript 6.0.3 and add a dedicated type-check task in CI.
- [x] Add a public declaration consumer test and type-check the AVA/TypeScript fixture.
- [x] Modernise fixture module resolution while preserving its ESM output.
- [x] Keep the JavaScript loader in JavaScript; a source-wide TypeScript rewrite is not required.
- [x] Retain the `ts-node` compatibility scenario and dependency: TypeScript 6
      maintains the compiler API required by compiler-API-based tooling.
- [x] Detect stale installed compiler versions before type-checking: the supplied
      dependency archive still contains TypeScript 4.9, which cannot parse the
      current Node 26 type declarations and is not the declared TypeScript 6.
- [x] Verify the TypeScript 6.0.3 checks and `ts-node` integration using the
      supplied dependency archive, including declaration and AVA fixture checks.
- [x] Keep TypeScript constrained to the 6.x line in `.ncurc.mjs` until TypeScript
      7.1+ and dependent API consumers are ready.

### 4. Update dependencies and CI hygiene

- [x] Inventory runtime and development dependencies against build scripts,
      fixtures, CLI tools and active compatibility scenarios. Preserve packages
      still required by Rspack/Babel until Phase 8 (see
      `docs/dependency-hygiene.md`).
- [ ] Review maintained-package updates against live registry metadata and
      apply only compatible, tested updates; do not force major-version churn
      ahead of Phase 8.
- [x] Audit the single runtime dependency, `punycode`: retain it because
      `src/real/punycode.js` explicitly loads the userland `punycode/` entry.
- [x] Keep CI on explicit Node/pnpm versions, cache the pnpm store, and surface
      failures for every Node version rather than cancelling the matrix early.
- [x] Separate `lint`, `typecheck`, `build`, and `test`; remove implicit
      `prelint`/`pretest` rebuilds and mutating CI lint.
- [x] Keep `pnpm fixtures:prepare` and `pnpm test:run` explicit for CI;
      make `pnpm test` automatically prepare fixtures and rebuild test bundles.
      Direct run-only invocation still fails fast when prerequisites are missing.
- [x] Propagate cleanup and child-process errors rather than silently passing
      builds or tests after a failed operation.
- [x] Pin the Test262 source revision for reproducible fixture preparation;
      fail closed on stale provenance and stage replacements before publishing.
- [x] Remove ten inactive security override selectors after comparing the
      pnpm 12 lockfile with transitive dependency requirements; document the
      23 retained selectors and legacy compatibility risks in
      `docs/dependency-hygiene.md`.
- [x] Add a high-severity production-dependency audit to Node 26 CI without
      suppressing registry errors or blocking other matrix entries.
- [ ] Triage a live full-dependency `pnpm audit:all` report; registry access was
      unavailable during the local Phase 4 review.
- [x] Remove ESLint in Phase 5, retain Mocha only for intentional host
      compatibility, and defer Rspack/Babel removal to Phase 8 so the current
      build remains functional.

For local verification, `pnpm test` automatically prepares fixtures and
rebuilds development test bundles; `pnpm test:prod` does the same for production.
CI can prepare once and use `pnpm test:run` or `pnpm test:run:prod` to avoid
duplicate work. `pnpm lint` is read-only; `pnpm lint:fix` applies Biome fixes.

### 5. Replace ESLint with Biome

- [x] Add `biome.json` with two-space indentation, double quotes, no optional
      semicolons, and a 100-column line-width target.
- [x] Apply Biome's recommended rules to loader source and test drivers;
      exclude generated/vendor code, syntax-error fixtures, and output snapshots.
      Preserve intentional loader globals, prototype shadowing, and language
      compatibility tests instead of automatically rewriting their semantics.
- [x] Format tracked loader source and tooling with Biome. Leave test source
      formatting disabled so exact-syntax and `this`/strict-mode tests are not
      rewritten; linting still covers the test drivers.
- [x] Replace ESLint with `biome check` in CI and Lefthook. Staged fixture files
      that are intentionally ignored do not cause a failed hook.
- [x] Remove `.eslintrc.js`, `.eslintignore`, nested ESLint configs,
      `babel-eslint`, `eslint`, and all direct `eslint-plugin-*` dependencies.
- [x] Keep normal lint read-only and independent of the build; use `pnpm lint:fix`
      only when applying formatter and safe lint fixes intentionally.


### 6. Validate and adopt Node.js 26

- [x] Add Node 26 to CI alongside Node 22/24, without changing runtime compatibility claims.
- [ ] Exercise the loader against changes to `Module._load`, `_compile`,
      `_extensions`, `_resolveFilename`, the module cache, and `require(esm)`.
- [ ] Test ESM/CJS interoperability, dynamic imports, hooks, cycles, errors,
      cached/uncached execution, and production/minified builds.
- [x] Add an isolated consumer smoke test that packs and installs the npm artefact,
      then checks the CommonJS API, ESM live bindings, and CLI preload.
- [x] Account for Node 26 dropping stream `domain` properties and changing
      proxy inspection formatting without relaxing namespace invariants.
- [ ] Confirm that Node 26 passes the full suite, production tests, and packed-package
      smoke test in CI before claiming support.
- [x] Stop passing `--experimental-worker` on Node 11.7+, where it is unnecessary.
- [x] Override transitive yargs 16/17 to the Node 26-compatible patch releases,
      so legacy Mocha compatibility scenarios do not load extensionless CommonJS as ESM.
- [x] Inventory Node 6-era compatibility adapters; keep observable behaviour intact
      and defer removal to Phase 8 parity checks (see `docs/test-fixtures-and-compatibility.md`).
- [x] Retain Node 24 support and Node 22 CI, without raising the existing
      `engines.node` range unless verification demonstrates it is inaccurate.
- [x] Keep tests running under real Node processes; do not infer loader
      compatibility from a test runner's transformed module environment.

### 7. Replace the internal Mocha runner with Vitest

- [x] Introduce Vitest 5 as a second runner, initially restricted to
      `test/vitest/**/*.test.{mjs,mts}` so loader fixtures are not transformed by Vite.
- [x] Migrate the CLI-hook scenarios into Vitest while retaining both cached and
      uncached environment coverage across development/production builds.
      Each test spawns a genuine Node process.
- [x] Run both Vitest and the remaining Mocha suite in CI and in the local
      development/production test commands; do not rebuild twice in CI.
- [x] Run compiler and output assertions directly in Vitest and register
      native-loader suites under Vitest through isolated `node:test` processes.
- [x] Report every native `node:test` case individually in Vitest without
      rerunning suites per assertion, and keep Vitest file parallelism enabled.
- [x] Move the native-Node eval/print hook matrix and built-in module checks to
      Vitest, sharing a subprocess harness with the existing CLI-hook tests.
      Preserve cached/uncached scenarios and skip historical Node-only cases.
- [x] Move the main CLI-entry hook scenarios (including error and symlink cases) to
      typed Vitest tests, retaining real Node process isolation and both cache modes.
      Convert the subprocess helper to TypeScript and type-check new `.mts` tests.
- [x] Preserve process-isolated tests for `require()` hooks, Node internals,
      module caches, CLI execution, and environment-dependent behaviours.
      Only move tests when their native-Node execution boundary is preserved.
- [x] Run development/production and cached/uncached loader scenarios as needed.
- [x] Keep the Test262 and Acorn validation paths reproducible; preserve
      standalone preparation and run-only commands while `pnpm test` remains
      self-contained for local development.
- [x] Confirm no internal coverage runner needs migration; `nyc` remains
      solely in external-tool compatibility scenarios.
- [x] Remove Mocha as the **internal** runner, its bootstrap and unused helpers.
- [x] Audit Mocha, Jest, AVA, Jasmine, Lab, and other host-runner dependencies.
      Keep them only for passing, intentional compatibility scenarios, as
      documented in `docs/test-fixtures-and-compatibility.md`.
- [x] Make CI run the complete Vitest suite, including isolated real-Node
      integration suites and both cached and uncached environments.
- [x] Replace the obsolete `sleep` NAN addon in native compatibility testing
      with a locally built Node-API fixture that imports a real `.node` binary.
      This preserves native-addon coverage across Node 22/24/26 without depending
      on a V8-specific ABI or changing production dependencies.

### Original-test parity and Test262 conformance baseline (21 October 2026)

The original `esm` suite audit found that the syntax-check, REPL, and Test262
suites were no longer registered after the test-runner migration. The syntax-check
and REPL integrations are now covered by real Node subprocess tests, and
`pnpm test:conformance` restores the separately runnable Test262 suite. The
conformance runner loads each testcase's declared harness includes and retains
the project's existing skiplist.

The pinned Test262 revision `d53ebc8b1931d9f1541e43d59650776e4b766248`
was run on **Linux x64 / Node 24.21.0** in the development-test environment
using `--harmony` and `ESM_OPTIONS={cjs:false,cache:false}`. Of 1,745 selected
cases, 27 were excluded by the **existing** skiplist. All 1,718 registered
cases executed: **1,104 passed, 614 failed, 0 skipped**. The full corpus has
**not** been validated on Node 22 or 26, and it is not part of the default
Vitest command. Do not report conformance as green.

| Test262 failure directory/group | Failures |
| --- | ---: |
| Top-level await | 242 |
| Dynamic import | 241 |
| Deferred imports (`import defer`) | 94 |
| `import.meta` | 7 |
| Import attributes | 6 |
| Import bytes | 5 |
| Ambiguous export bindings | 5 |
| Other module and export cases | 14 |
| **Total** | **614** |

These counts classify **test locations**, not proven root causes. Examples
include rejected top-level await, an invalid assignment target that is
executed instead of rejected during parsing, and an incorrectly reported
ambiguous export. Recent proposals (source-phase imports, deferred imports,
and import attributes) require separation of Node runtime restrictions,
harness support, and `esm-sync` loader defects before any fix is claimed.
Do not add blanket exclusions to conceal these failures.

- [x] Restore syntax-check and REPL tests using real Node subprocesses.
- [x] Restore pinned Test262 execution and per-test harness includes.
- [x] Restore meaningful ESM `--print` coverage: check the imported ESM value
      through the print flags and assert Node 22/24/26's explicit
      `ERR_EVAL_ESM_CANNOT_PRINT` for inline `import` under those flags.
      Modern Node rejects that CLI combination before the loader runs;
      `--eval` still tests an inline static import.
- [ ] Triage failing Test262 groups, distinguishing loader defects, Node
      runtime semantics, newer syntax, and any remaining harness gaps.
- [ ] Fix supported-language regressions first (negative syntax checks,
      ambiguous exports, namespace/cycle behaviour), with focused fixtures.
- [ ] Address or explicitly document top-level await, dynamic import, and
      newer module syntax separately, without widening the skiplist.
- [ ] Re-run the pinned corpus on supported Node versions and record the
      results before making a conformance claim or enabling a CI gate.
- [x] Restore macOS Intel and Windows x64 CI job registration for Node 22, 24,
      and 26 alongside Linux; configure MSVC for the native-addon test fixture.
- [ ] Verify the first GitHub-hosted macOS and Windows CI runs and address any
      platform-specific failures without skipping or weakening tests.

### 8. Replace Rspack and Babel with tsdown/Oxc

This is the highest-risk phase because `.babel.config.js` implements custom
semantic rewrites, not just syntax lowering. Do not translate those rules
blindly or assume Oxc provides equivalent Babel plugins.

- [ ] Inventory Babel-specific behaviours: loose class fields, arrow and block
      scoping, array-oriented `for...of`, `==`/`!=` rewrites, strict/sloppy
      directives, and production console/debugger removal.
- [ ] Prefer removing unnecessary rewrites by updating source for Node 26.
      Implement any still-required transformation with an appropriate Rolldown/
      Oxc-compatible mechanism, **without Babel**.
- [ ] Introduce `tsdown.config.*` for the distributable CommonJS loader and
      any separately built test entry points.
- [ ] Replicate the essential Rspack contracts: output filenames, `module.exports`
      shape, Node built-in externals, injected globals/banner, environment
      constants, Acorn regexp replacement, and the bundling/tree-shaking policy.
- [ ] Check resolver behaviour, vendored Acorn integration, module identity,
      dynamic imports, and production minification against the old output.
- [ ] Verify the published package contents: `esm.js`, `esm/loader.js`,
      `index.js`, and `index.d.ts`. Do not assume declaration generation is needed.
- [ ] Compare functional results first; then benchmark build time, memory,
      bundle size, and loader startup with repeatable measurements.
- [ ] Remove `.babel.config.js`, `babel-loader`, every unused `@babel/*` and
      `babel-plugin-*` package, Rspack packages/config, and build-only webpack
      plugins. Remove Terser/`.terserrc` if the new minification path replaces them.
- [ ] Remove legacy Node 6 transpilation targets; no Babel fallback is permitted.

## Future capability: await-free synchronous imports of async modules

**Product goal:** keep `esm-sync` a synchronous loader. Consumers should be able
to use the existing `require("esm-sync")(module)`-style API to load third-party
ESM and its dependencies without adding `await`, `.then()`, or an asynchronous
entry point. Ideally this would include modules with top-level `await` (TLA)
and transitive asynchronous dependencies. Prefer widening the set of modules
that can be loaded synchronously over introducing an async-first public API.

**Feasibility boundary:** a general Promise cannot reliably be made synchronous
on the same JavaScript thread. Its settlement may require timers, I/O, callbacks,
or microtasks that cannot make progress while that thread is blocked; some
Promises never settle. Native event-loop pumping or a worker can change which
cases make progress, but neither transparently preserves all JavaScript
semantics. This is a research goal, **not** a claim that arbitrary asynchronous
modules or libraries can already be imported synchronously.

Separate two requirements that are easy to conflate:

- **Synchronous module loading:** return the fully evaluated module namespace
  from `require()` before the call returns, including transitive dependencies
  where correct synchronous completion is actually possible.
- **Synchronous exported APIs:** imported functions declared `async` still
  return Promises under normal JavaScript semantics. Turning arbitrary exported
  async functions into synchronous functions is a separate, harder capability;
  do not silently change their return values or Promise identities.

The current linker already separates parsing/linking from evaluation, but
`src/entry.js` and `src/module/internal/compile.js` advance execution through
synchronous generator `.next()` calls. The existing limited `await` option
is **not** an async dependency-graph scheduler. Simply allowing TLA syntax or
recursively awaiting dependencies does not satisfy the synchronous API goal,
particularly for cyclic graphs.

### Research and implementation gates

- [ ] **Define the compatibility contract.** Keep existing synchronous imports,
      CommonJS interoperability, cycles, live bindings, module identity, and
      cache semantics unchanged. `require()` must never silently return a
      Promise, an incomplete namespace, or partially evaluated exports. When
      synchronous completion is impossible, produce a clear, deterministic
      failure rather than hanging or reporting a false successful import.
- [ ] **Classify async graphs before evaluation.** Reuse the existing compiler,
      linker, and entry state to detect direct/transitive TLA and distinguish
      eager dependencies from deferred imports. Determine which graphs can
      safely use the current synchronous evaluator before running bodies.
- [ ] **Prototype sync-compatible transformations first.** Test whether
      compiler-level rewriting or genuine synchronous equivalents of awaited
      operations can preserve semantics for a *documented subset* of modules.
      Do not assume `Promise.resolve(...)`, timers, `fetch()`, or arbitrary
      third-party async functions can all be unwrapped by the same mechanism.
- [ ] **Evaluate fallback mechanisms, not assumptions.** Benchmark and stress
      test native microtask/event-loop pumping against re-entrancy and deadlocks.
      Evaluate worker isolation plus a blocking bridge separately; account for
      thread startup, serialisation, object identity, closures, side effects,
      and live namespace bindings. Neither mechanism should become a default
      dependency without proving correctness and acceptable overhead.
- [ ] **Design graph-aware evaluation if a viable mechanism emerges.** Model
      async execution states, pending dependencies, cyclic components,
      completion/rejection propagation, and evaluation caching while reusing
      esm-sync's existing export binding and resolution machinery. Preserve
      deferred evaluation and reject impossible synchronous graphs safely.
- [ ] **Validate representative hard cases.** Include immediately fulfilled
      Promises, microtasks, timers, filesystem/network I/O, never-settling
      Promises, TLA cycles, rejected dependencies, repeated imports, and async
      exported functions. Run targeted Test262 cases and the regular cached,
      uncached, production, and cross-platform Node 22/24/26 suites. Measure
      cold/warm loading latency, CPU usage, and memory against the current
      synchronous path before claiming broad support.
- [ ] **Make a go/no-go decision before shipping.** If transparent conversion
      cannot meet the above correctness gates, document the supported subset
      and explicit failure behaviour. Do not weaken Test262 assertions, add a
      second independent linker, or require consumers to use `await` merely to
      make the conformance count look better.

This track is distinct from the Phase 8 build-tool migration. Keep toolchain
cleanup and synchronous-loader compatibility moving independently of any
speculative async-to-sync execution mechanism.

## Deferred follow-up: TypeScript 7.1 or later

TypeScript 7.0 removed the JavaScript compiler API used by tools such as
`ts-node`. The TypeScript team expects a new, **different** API in 7.1; this
is not a guarantee that existing API consumers will work unchanged. Do not
upgrade the main compiler to 7.0 or remove the `ts-node` scenario prematurely.

- [ ] Wait for a stable TypeScript 7.1+ release with the replacement API.
- [ ] Verify `ts-node` and other compiler-API consumers support it, or migrate
      those integrations to maintained alternatives.
- [ ] Upgrade in a separate patch; repeat declaration checks, fixture compilation,
      real-Node integration tests, CI, and packed-package checks.
- [ ] Only then remove the TypeScript 6 major-version constraint in `.ncurc.mjs`.

## Compatibility-test dependency policy

Several apparently obsolete packages are used in `test/scenario-tests.mjs` to
verify integration with external tooling (including Babel, webpack, `ts-node`,
Mocha, Jest, AVA, and Jasmine). These are **not** necessarily part of the build
pipeline. For each scenario, either:

1. Keep it as an explicitly named, passing integration test with isolated
   dependencies and a justified compatibility requirement; or
2. Retire the scenario and remove its fixtures, imports, and dependencies.

Do not retain legacy packages merely because they were historically installed.
In particular, remove Babel-based integration fixtures unless supporting Babel
as a third-party host is an explicit product requirement; Babel must not be used
to compile or test the project's own source after phase 8.

## Release gates and definition of done

- [ ] Tests are green before and after each phase; failures are not swallowed by scripts.
- [ ] Development, production, cached, and uncached module-loading behaviours
      match the baseline unless changes have explicit regression tests and release notes.
- [ ] Node 26 CI, Biome, TypeScript 6 checking, Vitest, real-Node integration
      tests, tsdown build, and a packed-package smoke test all pass.
- [ ] Only Lefthook, pnpm 12, TypeScript 6, Biome, Vitest, and tsdown/Oxc remain
      as the primary development stack; superseded configs, scripts, and
      build/lint/test dependencies are removed.
- [ ] Any retained legacy package exists solely for documented interoperability
      coverage, not as a parallel implementation of the main toolchain.
- [ ] Publish a breaking major version if the supported Node range, loader
      behaviour, or public entry-point contract changes.

## Reference documentation

- [Node.js release schedule](https://github.com/nodejs/Release)
- [pnpm 12 release](https://pnpm.io/blog/releases/12.0)
- [TypeScript 6 release notes][typescript-6]
- [TypeScript 7 announcement and API limitations][typescript-7]
- [Vitest guide](https://vitest.dev/guide/)
- [tsdown documentation](https://tsdown.dev/)

[typescript-6]: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
[typescript-7]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
