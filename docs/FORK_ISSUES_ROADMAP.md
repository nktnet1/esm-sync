# Roadmap

A practical plan for the 83 reported issues, reviewed on 29 October 2026. Issues link to their original reports. Work is ordered by impact, not by release date.

| Status                |  Count |
| --------------------- | -----: |
| Fix confirmed bugs    |      0 |
| Investigate           |      8 |
| Improve documentation |      4 |
| Already covered       |     48 |
| Not planned           |     23 |
| **Total**             | **83** |

## Confirmed fixes complete

The high-priority crash, module-behaviour, and observable compatibility fixes are complete. The cache, coverage, and mocking reports also have fixes or documented boundaries with regression coverage. Dedicated upstream regressions cover the linked reports; feature tests cover broader behaviour and compare with native Node where appropriate. The remaining reports below need investigation or documentation.

## Investigate before committing to a fix

These reports may still matter, but need a current reproduction or a clear decision about supported behaviour.

### Tooling and performance

The verified fixture behaviour and remaining gaps are recorded in
[`docs/tooling-and-performance.md`](tooling-and-performance.md). Tests run in real
Node subprocesses with the fork's installed tooling, rather than claiming
compatibility with versions or applications we have not exercised.

- [#844](https://github.com/standard-things/esm/issues/844) — Bootstrap cache faults were fixed in v1.0.3. The follow-up removes require-only AST parsing and unnecessary legacy-await wrappers, adds built-application benchmarking, and measures the available Execa dependency graph. The uploaded Log4brains 1.1.0 source has no built packages/dependency tree; its current launcher does not preload esm, so a full application startup comparison remains unverified.
- [#810](https://github.com/standard-things/esm/issues/810) — The supplied await-only database source exposed early-return sequencing; module-goal detection is fixed. Transformed-source cache keys and stable cross-factory await tokens fix Babel output/configuration transitions. Regressions cover both module outputs, preload orders, and cold/warm caches. The original module-resolver 3.2.x runtime dependency tree is still missing, so that exact Express integration remains unverified.

### Other runtimes and execution contexts

- [#915](https://github.com/standard-things/esm/issues/915) — Test loading ESM from a current VS Code extension host.
- [#867](https://github.com/standard-things/esm/issues/867) — Test Electron renderer integration with supported settings.
- [#817](https://github.com/standard-things/esm/issues/817) — Isolate the reported Electron dynamic-import crash from native-addon problems.
- [#691](https://github.com/standard-things/esm/issues/691) — Check error stack traces in Electron renderer processes.
- [#854](https://github.com/standard-things/esm/issues/854) — Decide whether custom REPL instances need an import hook.
- [#886](https://github.com/standard-things/esm/issues/886) — `vm.runInThisContext` parses scripts, not modules; only pursue this as an explicit extra feature.

## Improve documentation

- [#885](https://github.com/standard-things/esm/issues/885) — Show what `cjs.dedefault` changes, with a short example.
- [#873](https://github.com/standard-things/esm/issues/873) — Explain Mocha preload versus calling the loader factory in a setup file.
- [#865](https://github.com/standard-things/esm/issues/865) — Explain global-variable rewriting for contributors.
- [#838](https://github.com/standard-things/esm/issues/838) — Add guidance for moving to native Node ESM.

## Already covered

These have an existing fix, supported behaviour, or an explanation that requires no code change. Coverage here does not imply every third-party environment has been tested.

- [#931](https://github.com/standard-things/esm/issues/931) — Modern Node filesystem-internal changes are handled; basic loader checks pass.
- [#926](https://github.com/standard-things/esm/issues/926) — Optional chaining works alongside `eval` text.
- [#924](https://github.com/standard-things/esm/issues/924) — Package exports take precedence over legacy entry points, select conditions in declaration order, and support `.cjs` targets. The reported `remotion/version` require and broader import/require, cache, and validation cases have regression coverage.
- [#922](https://github.com/standard-things/esm/issues/922) — Synchronous CommonJS-to-ESM loading is supported through the loader factory.
- [#921](https://github.com/standard-things/esm/issues/921) — The syntax failure is covered; imports normally evaluate top-level code.
- [#918](https://github.com/standard-things/esm/issues/918) — Optional chaining is supported.
- [#916](https://github.com/standard-things/esm/issues/916) — Persistent compiler-cache settings do not invalidate evaluated modules. The reported configuration and fresh-process behaviour are tested and explained in `docs/caching-coverage-and-mocking.md`; implicit hot reload is not part of those settings.
- [#914](https://github.com/standard-things/esm/issues/914) — Errors no longer produce a wall of bundled loader source in the tested case.
- [#913](https://github.com/standard-things/esm/issues/913) — Worker threads can use imports when the loader is preloaded.
- [#910](https://github.com/standard-things/esm/issues/910) — NYC hooks survive bootstrap, instrumented compiler caches are separated by configuration, and `ESM_DISABLE_CACHE` bypasses persistent reads/writes without deleting existing caches. Tests assert real coverage counters, warm runs, changed include rules, and cache-disable values.
- [#909](https://github.com/standard-things/esm/issues/909) — Nullish coalescing is supported.
- [#904](https://github.com/standard-things/esm/issues/904) — `node:` built-in imports are supported.
- [#900](https://github.com/standard-things/esm/issues/900) — The CJS-to-ESM loading case works; Electron packaging was not verified.
- [#898](https://github.com/standard-things/esm/issues/898) — ESM packages using `"type": "module"` can be loaded through the CommonJS bridge.
- [#897](https://github.com/standard-things/esm/issues/897) — The same `"type": "module"` workaround is no longer required.
- [#896](https://github.com/standard-things/esm/issues/896) — Errors produce useful stack traces rather than the full loader bundle.
- [#888](https://github.com/standard-things/esm/issues/888) — The README documents synchronous loading.
- [#887](https://github.com/standard-things/esm/issues/887) — Jasmine integration has examples and tests.
- [#880](https://github.com/standard-things/esm/issues/880) — Native Node's CommonJS named-export rules differ; this is a migration concern.
- [#879](https://github.com/standard-things/esm/issues/879) — Nullish coalescing works with imports.
- [#876](https://github.com/standard-things/esm/issues/876) — Modern Node compatibility work supersedes the older general report.
- [#875](https://github.com/standard-things/esm/issues/875) — ESM Jest test sources can use esm-sync directly as their configured transformer. Installed Jest 26 tests exercise globals, lexical `jest`, live bindings, direct/transitive imports, and dynamic imports. Newer Jest runtimes remain unverified.
- [#874](https://github.com/standard-things/esm/issues/874) — Updated files are picked up in a fresh process; same-process reload is tracked under #916.
- [#872](https://github.com/standard-things/esm/issues/872) — Default-export namespace behaviour is expected; `cjs.dedefault` controls unwrapping.
- [#868](https://github.com/standard-things/esm/issues/868) — Loading `"type": "module"` packages from CommonJS works.
- [#866](https://github.com/standard-things/esm/issues/866) — Optional chaining is supported.
- [#864](https://github.com/standard-things/esm/issues/864) — Migration options and module boundaries are supported.
- [#863](https://github.com/standard-things/esm/issues/863) — Legacy folder maps support root and nested exports, while null and unexported subpaths remain blocked. The reported `"./": "./dist/"` mapping has a dedicated upstream regression; modern patterns and boundary checks have separate coverage.
- [#855](https://github.com/standard-things/esm/issues/855) — The earlier `"type": "module"` warning is not reproduced.
- [#852](https://github.com/standard-things/esm/issues/852) — A transpiler's post-link compile preserves registered import bindings, so NYC/Mocha/ts-node can call exported TypeScript functions. Tests cover both CommonJS and preserved ESM output, with source-mapped coverage checks.
- [#846](https://github.com/standard-things/esm/issues/846) — Module binding discovery follows `var` through nested statements without crossing function or class boundaries. The reported export and broader hoisting, destructuring, scope, and live-binding cases have regression coverage.
- [#843](https://github.com/standard-things/esm/issues/843) — Invalid zero-width tokens report a syntax error instead of resuming tokenization; the original source and broader tokenizer cases have regression coverage.
- [#841](https://github.com/standard-things/esm/issues/841) — Build instructions are available in `docs/build-layout.md`.
- [#839](https://github.com/standard-things/esm/issues/839) — NYC can start `.mjs` entry points and instrument their dependencies through the installed extension transform. Dedicated entry-point and original-source coverage tests guard the reported integration.
- [#824](https://github.com/standard-things/esm/issues/824) — The inspector console bridge uses the host's argument signature, so console output and inspector events do not acquire an extra configuration object. Object formatting, placeholders, console methods, custom consoles, and event delivery have native-comparison coverage.
- [#821](https://github.com/standard-things/esm/issues/821) — Node filesystem/stat compatibility is handled.
- [#816](https://github.com/standard-things/esm/issues/816) — Basic repeated initialization does not reproduce the `__global__` error.
- [#813](https://github.com/standard-things/esm/issues/813) — `Object.assign` preserves added properties in the tested mixed-module case.
- [#812](https://github.com/standard-things/esm/issues/812) — CommonJS default imports and namespace descriptors preserve the exports object without reading its own `default` accessor. Explicit property access and mutations retain that synthetic binding; transpiled `__esModule` defaults keep their configured interop behaviour.
- [#809](https://github.com/standard-things/esm/issues/809) — The Reflect shim forwards CommonJS polyfill changes and ESM mutations to the same backing object while retaining namespace safeguards. Direct/transitive polyfills, accessors, method replacement, and frozen descriptors have regression coverage.
- [#805](https://github.com/standard-things/esm/issues/805) — Mock selection precedes real dependency execution, and abandoned linking records no longer poison later re-export loads. The reported rewiremock-style `Module._load`/cache-reset sequence has a dedicated regression; the historical rewiremock package was not run.
- [#798](https://github.com/standard-things/esm/issues/798) — Import finalization is scoped to the importer, so an unused named import cannot replace another module's proxyquire stub. The original local/global stub sequence and binding isolation have regression coverage with proxyquire.
- [#796](https://github.com/standard-things/esm/issues/796) — Executable configuration has a temporary default package and completes evaluation during cold startup. All supported config formats, dependencies, warm caches, and failed-initialization recovery have regression coverage.
- [#794](https://github.com/standard-things/esm/issues/794) — `mainFields: ["module", "main"]` selects a package's TypeScript `module` source and falls back to `main` where needed. Real subprocess fixtures verify both ts-node and Babel extension hooks with their source transforms configured. See [tooling and performance](tooling-and-performance.md).
- [#786](https://github.com/standard-things/esm/issues/786) — Internal `.mjs` imports intentionally bypass CommonJS mocking hooks. Tests distinguish `.js` interception from strict `.mjs` graphs, and `docs/caching-coverage-and-mocking.md` explains that boundary and top-level require interception.
- [#779](https://github.com/standard-things/esm/issues/779) — Jest contexts use their executing realm's intrinsic eval, retaining lexical `require` for the historical protobuf optional-filesystem probe. Actual protobufjs `loadSync`, message round trips, eval imports, reset/isolation, and custom eval have regressions. The old gRPC application's exact dependency set was not supplied.
- [#775](https://github.com/standard-things/esm/issues/775) — Startup drains queued callbacks without suppressing their deprecations or restoring over application changes to `process.noDeprecation`. Chained warning listeners, callback ordering, and deprecation flags have native-comparison coverage.
- [#706](https://github.com/standard-things/esm/issues/706) — The package provides Jest `process`/`getCacheKey` methods, supports cold/warm transform caches, observes edited dependencies, and avoids transforming itself recursively. Modern API signatures/native-ESM passthrough have contract checks; Jest 29/30 were not installed or executed.

## Not planned

These reports are unrelated to the loader, outside its intended scope, specific to obsolete tooling, or too incomplete to act on as reported.

- [#930](https://github.com/standard-things/esm/issues/930) — An obsolete native `sleep` dependency caused the old install failure.
- [#929](https://github.com/standard-things/esm/issues/929) — NestJS parameter decorators are a separate TypeScript concern.
- [#928](https://github.com/standard-things/esm/issues/928) — A missing `Parse` global points to application setup.
- [#927](https://github.com/standard-things/esm/issues/927) — Appium's `wrap-ansi` dependency failed during installation.
- [#920](https://github.com/standard-things/esm/issues/920) — The missing file extension is a native Node resolution issue.
- [#919](https://github.com/standard-things/esm/issues/919) — Maintenance-status discussion; no technical task.
- [#917](https://github.com/standard-things/esm/issues/917) — StackBlitz/WebContainer support is not an established requirement.
- [#907](https://github.com/standard-things/esm/issues/907) — No loader-specific reproduction was provided.
- [#903](https://github.com/standard-things/esm/issues/903) — Suppressed console output appears related to Lerna.
- [#893](https://github.com/standard-things/esm/issues/893) — Project-maintenance discussion; no code change.
- [#892](https://github.com/standard-things/esm/issues/892) — Node's JavaScript syntax checker does not accept YAML.
- [#890](https://github.com/standard-things/esm/issues/890) — React Native cannot bundle this Node-specific loader directly.
- [#884](https://github.com/standard-things/esm/issues/884) — HTTPS module imports require a separate network loader.
- [#869](https://github.com/standard-things/esm/issues/869) — Azure Functions v2 startup is a legacy deployment concern.
- [#862](https://github.com/standard-things/esm/issues/862) — Consumers must load ESM correctly; publishing with ESM does not configure consumers.
- [#861](https://github.com/standard-things/esm/issues/861) — PM2 could not locate the installed package.
- [#859](https://github.com/standard-things/esm/issues/859) — An offline compile-to-distribution API is a separate feature request.
- [#845](https://github.com/standard-things/esm/issues/845) — Heroku deployment lacked a reproducible loader failure.
- [#833](https://github.com/standard-things/esm/issues/833) — YAML needs its own parser or transform, not JavaScript parsing.
- [#829](https://github.com/standard-things/esm/issues/829) — Insufficient information to identify a loader bug.
- [#828](https://github.com/standard-things/esm/issues/828) — Browser-oriented Webpack builds cannot use Node-only filesystem APIs.
- [#791](https://github.com/standard-things/esm/issues/791) — Old `resolve-dir` REPL report lacks a current reproduction.
- [#780](https://github.com/standard-things/esm/issues/780) — The `pkg` snapshot runtime requires unsupported internal compatibility.

When revisiting an issue, first reproduce it on a supported Node version and add a regression test before marking it fixed.
