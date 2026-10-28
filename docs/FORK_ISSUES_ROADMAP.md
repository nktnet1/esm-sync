# Roadmap

A practical plan for the 83 reported issues, reviewed on 28 October 2026. Issues link to their original reports. Work is ordered by impact, not by release date.

| Status                |  Count |
| --------------------- | -----: |
| Fix confirmed bugs    |      7 |
| Investigate           |     19 |
| Improve documentation |      4 |
| Already covered       |     30 |
| Not planned           |     23 |
| **Total**             | **83** |

## Fix next

### High priority: crashes and incorrect module behaviour

- [#846](https://github.com/standard-things/esm/issues/846) — Exports of `var` declarations inside blocks are incorrectly rejected. Respect JavaScript hoisting rules.
- [#809](https://github.com/standard-things/esm/issues/809) — Changes to `Reflect` made by CommonJS polyfills are not visible in ES modules.
- [#924](https://github.com/standard-things/esm/issues/924) — Package `exports` support needs correct `import`/`require` conditions and `.cjs` targets.
- [#863](https://github.com/standard-things/esm/issues/863) — Package `exports` maps must block access to unexported subpaths. Address alongside #924.

### Next: observable compatibility bugs

- [#812](https://github.com/standard-things/esm/issues/812) — Importing CommonJS can unexpectedly invoke a `default` getter.
- [#775](https://github.com/standard-things/esm/issues/775) — A warning listener can miss the second deprecation warning.
- [#824](https://github.com/standard-things/esm/issues/824) — Starting with `--inspect` can print an extra `{}` to the console.

For each fix, add a small regression test and compare behaviour with native Node where appropriate.

## Investigate before committing to a fix

These reports may still matter, but need a current reproduction or a clear decision about supported behaviour.

### Cache, coverage, and mocking

- [#910](https://github.com/standard-things/esm/issues/910) — Check NYC coverage accuracy, cache separation, and `ESM_DISABLE_CACHE` behaviour.
- [#852](https://github.com/standard-things/esm/issues/852) — Retest NYC with `ts-node` and exports.
- [#839](https://github.com/standard-things/esm/issues/839) — Retest NYC with `.mjs` files.
- [#805](https://github.com/standard-things/esm/issues/805) — Check rewiremock, re-exports, and module caching together.
- [#798](https://github.com/standard-things/esm/issues/798) — Check whether proxyquire can intercept otherwise unused imports.
- [#786](https://github.com/standard-things/esm/issues/786) — `.mjs` imports bypass `Module._load` mocks; decide whether interception is supported.
- [#916](https://github.com/standard-things/esm/issues/916) — Clarify whether disabling the compiler cache should allow hot reload; it does not reset evaluated modules.

### Tooling and performance

- [#844](https://github.com/standard-things/esm/issues/844) — Benchmark cold and warm startup before making performance changes.
- [#779](https://github.com/standard-things/esm/issues/779) — Recheck Jest, protobufjs, and filesystem access.
- [#875](https://github.com/standard-things/esm/issues/875) — Verify ESM loading in current Jest configurations.
- [#706](https://github.com/standard-things/esm/issues/706) — Verify Jest transforms against a modern reproduction.
- [#810](https://github.com/standard-things/esm/issues/810) — Test top-level await together with module aliases.
- [#794](https://github.com/standard-things/esm/issues/794) — Test `mainFields` when TypeScript transformation hooks are present.

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
- [#922](https://github.com/standard-things/esm/issues/922) — Synchronous CommonJS-to-ESM loading is supported through the loader factory.
- [#921](https://github.com/standard-things/esm/issues/921) — The syntax failure is covered; imports normally evaluate top-level code.
- [#918](https://github.com/standard-things/esm/issues/918) — Optional chaining is supported.
- [#914](https://github.com/standard-things/esm/issues/914) — Errors no longer produce a wall of bundled loader source in the tested case.
- [#913](https://github.com/standard-things/esm/issues/913) — Worker threads can use imports when the loader is preloaded.
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
- [#874](https://github.com/standard-things/esm/issues/874) — Updated files are picked up in a fresh process; same-process reload is tracked under #916.
- [#872](https://github.com/standard-things/esm/issues/872) — Default-export namespace behaviour is expected; `cjs.dedefault` controls unwrapping.
- [#868](https://github.com/standard-things/esm/issues/868) — Loading `"type": "module"` packages from CommonJS works.
- [#866](https://github.com/standard-things/esm/issues/866) — Optional chaining is supported.
- [#864](https://github.com/standard-things/esm/issues/864) — Migration options and module boundaries are supported.
- [#855](https://github.com/standard-things/esm/issues/855) — The earlier `"type": "module"` warning is not reproduced.
- [#843](https://github.com/standard-things/esm/issues/843) — Invalid zero-width tokens report a syntax error instead of resuming tokenization; the original source and broader tokenizer cases have regression coverage.
- [#841](https://github.com/standard-things/esm/issues/841) — Build instructions are available in `docs/build-layout.md`.
- [#821](https://github.com/standard-things/esm/issues/821) — Node filesystem/stat compatibility is handled.
- [#816](https://github.com/standard-things/esm/issues/816) — Basic repeated initialization does not reproduce the `__global__` error.
- [#813](https://github.com/standard-things/esm/issues/813) — `Object.assign` preserves added properties in the tested mixed-module case.
- [#796](https://github.com/standard-things/esm/issues/796) — Executable configuration has a temporary default package and completes evaluation during cold startup. All supported config formats, dependencies, warm caches, and failed-initialization recovery have regression coverage.

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
