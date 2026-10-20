# Modernisation roadmap

Modernise `esm-sync` for Node.js 26, replace the development toolchain, and remove
superseded dependencies and configuration. Keep the published CommonJS loader's
observable behaviour intact unless an intentional breaking change is documented.

## Target stack

| Area | Current | Target |
| --- | --- | --- |
| Runtime | Node.js `>=6`; CI on 22/24 | Node.js 26 |
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
- [ ] Verify `pnpm typecheck` and `ts-node` integration using installed TypeScript 6;
      the supplied dependencies still contain TypeScript 4.9.
- [ ] Keep TypeScript constrained to the 6.x line in `.ncurc.mjs` until TypeScript
      7.1+ and dependent API consumers are ready.

### 4. Update dependencies and CI hygiene

- [ ] Update maintained runtime and development packages in small, tested groups.
- [ ] Audit the single runtime dependency, `punycode`, for actual necessity.
- [ ] Update GitHub Actions and use pinned, reproducible Node/pnpm setup.
- [ ] Separate `lint`, `typecheck`, `build`, and `test` tasks; remove implicit
      `prelint`/`pretest` rebuilds and avoid network downloads during normal tests.
- [ ] Review security overrides and unused dependencies; keep overrides only
      where they remain necessary and document intentional pins.
- [ ] Defer removal of ESLint, Mocha, Rspack, and Babel packages until their
      replacement phases, so this phase does not break the existing toolchain.

### 5. Replace ESLint with Biome

- [ ] Add `biome.json` with the repository's formatting conventions (100-column limit).
- [ ] Migrate applicable lint rules, explicitly accounting for the loader's
      unusual but intentional patterns and generated/vendor files.
- [ ] Run `biome check --write` on tracked source and tooling files; review the diff.
- [ ] Make `biome check` the CI gate and Lefthook's staged-file check.
- [ ] Remove `.eslintrc.js`, `.eslintignore`, nested ESLint configs, ESLint plugins,
      `babel-eslint`, and `eslint` itself.
- [ ] Verify that linting no longer triggers a build or mutates files in CI.

### 6. Validate and adopt Node.js 26

- [ ] Add Node 26 to CI before changing runtime compatibility claims.
- [ ] Exercise the loader against changes to `Module._load`, `_compile`,
      `_extensions`, `_resolveFilename`, the module cache, and `require(esm)`.
- [ ] Test ESM/CJS interoperability, dynamic imports, hooks, cycles, errors,
      cached/uncached execution, and production/minified builds.
- [ ] Test installation and usage of the **packed** npm artefact, not only the repository.
- [ ] Identify Node 6-era runtime shims for removal and defer Babel-specific
      changes until the tsdown phase validates output parity.
- [ ] Explicitly decide whether Node 24 remains supported. If Node 26 becomes
      the minimum, set `engines.node` accordingly and release it as a breaking major.
- [ ] Keep tests running under real Node processes; do not infer loader
      compatibility from a test runner's transformed module environment.

### 7. Replace the internal Mocha runner with Vitest

- [ ] Migrate ordinary assertions, hooks, mocks, and test files to Vitest.
- [ ] Preserve process-isolated tests for `require()` hooks, Node internals,
      module caches, CLI execution, and environment-dependent behaviours.
- [ ] Run production/development and cached/uncached loader scenarios as needed.
- [ ] Keep the Test262 and Acorn validation paths reproducible; make fixture
      preparation explicit instead of hiding it in the normal test command.
- [ ] Migrate internal coverage to Vitest's coverage provider if coverage is used.
- [ ] Remove Mocha as the **internal** runner, its bootstrap and unused helpers.
- [ ] Retain Mocha, Jest, AVA, Jasmine, or other runner packages **only** when
      an intentional, passing third-party compatibility scenario exercises them.
      Otherwise remove the scenarios and dependencies together.
- [ ] Make CI run both Vitest and the separate real-Node integration suite.

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
