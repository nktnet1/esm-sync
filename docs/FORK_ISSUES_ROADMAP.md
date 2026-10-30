# Upstream issue roadmap

Status as of 30 October 2026 for the 83 reports in
[`standard-things/esm`](https://github.com/standard-things/esm/issues).
The tests and source code, not a historical status label, are authoritative for
current behaviour. Keep an issue open when its exact integration has not been
verified. See [tooling and performance](tooling-and-performance.md) for evidence
on the two application reproductions.
For the five newly supplied host-integration asset archives, see
[fixes and evidence-collection instructions](host-integrations.md).

| Classification                                |  Count |
| --------------------------------------------- | -----: |
| Confirmed fixes still awaiting implementation |      0 |
| Investigate                                   |      5 |
| Documentation follow-ups                      |      0 |
| Already covered                               |     55 |
| Not planned                                   |     23 |
| **Total**                                     | **83** |

## Verified application integration

- **Babel aliases and top-level await** - [https://github.com/standard-things/esm/issues/810](https://github.com/standard-things/esm/issues/810). **Fixed for the supported native-bridge startup path**. The physical root `esm.js`/`index.js` shims were not recognised as preloads because their metadata paths retained `dist/../`. Resolving those paths installs the same hooks as the generated entry. The unchanged original Express/Babel configuration passes checks for single database evaluation and database completion before `listen()`, followed by the expected HTTP response. Verification covers both preload orders and disabled/cold/warm caches. Timer awaits on Node 20 remain outside the native bridge's supported range and fail explicitly. This does not extend legacy timer-await support. See the [verification evidence](tooling-and-performance.md#babel-aliases-and-top-level-await).

- **Startup performance** - [https://github.com/standard-things/esm/issues/844](https://github.com/standard-things/esm/issues/844). **Resolved**. Canonical production builds verify the historical Log4brains CLI and complete preview HTTP readiness. v1.0.11 reduced repeated CommonJS stack checks and captured bytecode after initialisation. v1.0.12 reduces retained warm-cache compilation state while preserving cold compilation and bytecode capture. See the [release measurements](tooling-and-performance.md#lower-startup-memory-v1012).

## Verified custom REPL integration

- **Programmatic REPL static imports** - [https://github.com/standard-things/esm/issues/854](https://github.com/standard-things/esm/issues/854). **Fixed for the tested Node 22, 24, and 26 preload path**. An application's `repl.start()` does not enter the same startup branch as `node -i`. A one-time, lazy context hook now activates REPL compilation when the application first creates a server. Non-REPL `vm.createScript()` calls retain their normal behaviour, including after creating multiple REPL servers. Tests cover cached and uncached configurations, custom prompts, sloppy mode, isolated contexts, relative-file imports, repeated imports, and a second active server. This does not change arbitrary `vm` script evaluation or promise rejection handling in the Node REPL.

## Active investigations

### Electron and extension-host integrations

- **VS Code extension-host ESM loading** - [https://github.com/standard-things/esm/issues/915](https://github.com/standard-things/esm/issues/915). **Native ESM rejection and virtual CommonJS host-module handoff fixed; rebuilt desktop activation remains unverified.** The supplied VS Code logs exposed `ERR_REQUIRE_ESM` from its native `.js` handler before compilation. The loader now uses its installed compiler for that rejection without retrying errors thrown after compilation starts. Tests disable modern Node's native `require(esm)`, which previously concealed the failure, and retain per-extension virtual APIs and cache checks. The original compiled extension runs under Node with a stubbed VS Code API and the attached `get-port`; successful desktop activation/reload results are still needed. See [verification steps](host-integrations.md#vs-code-extension-loading-915).
- **Electron renderer module loading** - [https://github.com/standard-things/esm/issues/867](https://github.com/standard-things/esm/issues/867). **Stale renderer base directory fixed; real-window/reload verification remains open.** The supplied Electron 8 binary's embedded renderer code sets the injected module's page filename and search paths but leaves its `path` pointing to `electron/js2c`. The loader now uses the page directory for that stale injected record. Native Node regressions exercise the exact record shape, separate pages, dependency lookup, repeated factories and disk-cache reloads without changing the supplied module. The actual browser run still needs a host with Electron's system libraries and a display. See [collection steps](host-integrations.md#renderer-resolution-867).
- **Electron dynamic imports and native-addon failures** - [https://github.com/standard-things/esm/issues/817](https://github.com/standard-things/esm/issues/817). **Node-side cache corruption fixed, Electron hang still unverified.** A real addon built for a different Node ABI rejects with `ERR_DLOPEN_FAILED` on Node 22, 24, and 26. Repeated imports exposed a separate defect: after an ESM re-export failed while requiring a native addon, a later import could reuse an incomplete CommonJS linking record and incorrectly return empty exports. The failed graph now discards only its incomplete staged CommonJS dependencies. Regression coverage exercises repeated and concurrent rejections in preload and factory modes with and without disk caching. The archived `crash.js` uses a valid `.catch(error => ...)` handler, unlike the abbreviated syntax in the issue description. The original Electron 5 process hang still requires a runnable Electron build with a mismatched addon to verify. Do not mark the host-specific failure resolved on Node-only evidence.
- **Electron renderer error stacks** - [https://github.com/standard-things/esm/issues/691](https://github.com/standard-things/esm/issues/691). **Still missing original/host evidence.** The archive contains an alternative template and a generated substitute, not the deleted upstream reproduction. Node loader exceptions are masked, but Chromium's stored error location and `window.onerror` presentation are not established by `error.stack` alone. No suppressing renderer event handler is installed. See the [diagnostic listener and required captures](host-integrations.md#chromium-error-presentation-691).

### VM API boundary

- **Static imports in `vm.runInThisContext`** - [https://github.com/standard-things/esm/issues/886](https://github.com/standard-things/esm/issues/886). Reproduced on Node 22, 24, and 26, including the supplied probe. This API compiles script-goal code and does not accept static `import` declarations. Use the existing loader factory for the supplied file, or Node's separate `vm.SourceTextModule` API with an explicit linker. See [supported alternatives](host-integrations.md#static-imports-in-vm-scripts-886). Automatic transpilation of arbitrary VM scripts remains a separate feature decision.

## Completed documentation follow-ups

All four reports now have documentation coverage in this fork. The examples
were checked against the release runtime, Mocha 8.4.0, and native Node ESM.
This records local completion rather than changes to the upstream issue tracker.

| Report                                                                                                 | Documentation                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [https://github.com/standard-things/esm/issues/885](https://github.com/standard-things/esm/issues/885) | [`cjs.dedefault`: examples and export-shape boundaries](interop-and-migration.md#commonjs-default-export-unwrapping)           |
| [https://github.com/standard-things/esm/issues/873](https://github.com/standard-things/esm/issues/873) | [Mocha preloads and configured factory entry points](interop-and-migration.md#mocha-preloads-and-factory-entry-points)         |
| [https://github.com/standard-things/esm/issues/865](https://github.com/standard-things/esm/issues/865) | [Contributor guide to global-reference rewriting](MAINTAINER_GUIDE.md#global-reference-rewriting)                              |
| [https://github.com/standard-things/esm/issues/838](https://github.com/standard-things/esm/issues/838) | [Native Node ESM migration and asynchronous startup](interop-and-migration.md#migrating-a-consumer-project-to-native-node-esm) |

## Triaged, not currently actionable

The following **55** reports are classified _already covered_ by an existing
fix, regression, supported behaviour, or documented boundary. That does not
certify every historical third-party application: reopen on a concrete failing
reproduction.

931, 926, 924, 922, 921, 918, 916, 914, 913, 910, 909, 904, 900, 898, 897,
896, 888, 887, 885, 880, 879, 876, 875, 874, 873, 872, 868, 866, 865, 864, 863, 855, 854, 852,
846, 844, 843, 841, 839, 838, 824, 821, 816, 813, 812, 810, 809, 805, 798, 796, 794,
786, 779, 775, 706.

The following **23** reports are _not planned_: they concern external tooling,
obsolete environments, different products, unsupported feature requests, or
insufficient reproductions.

930, 929, 928, 927, 920, 919, 917, 907, 903, 893, 892, 890, 884, 869, 862,
861, 859, 845, 833, 829, 828, 791, 780.

For build, fixture, and compatibility-test commands, see the
[maintainer guide](MAINTAINER_GUIDE.md). Do not mark an investigation fixed
based solely on a synthetic test or a passing CLI startup.
