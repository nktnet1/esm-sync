# Upstream issue roadmap

Status as of 30 October 2026 for the 83 reports in
[`standard-things/esm`](https://github.com/standard-things/esm/issues).
The tests and source code, not a historical status label, are authoritative for
current behaviour. Keep an issue open when its exact integration has not been
verified. See [tooling and performance](tooling-and-performance.md) for evidence
on the two application reproductions.

| Classification                                |  Count |
| --------------------------------------------- | -----: |
| Confirmed fixes still awaiting implementation |      0 |
| Investigate                                   |      5 |
| Documentation follow-ups                      |      
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

- **VS Code extension-host ESM loading** - [https://github.com/standard-things/esm/issues/915](https://github.com/standard-things/esm/issues/915). The original TypeScript extension was compiled to CommonJS and attempted to require the ESM-only `get-port` package. The fork's loader supports synchronous ESM interop in Node, but an actual extension activation must be tested in the VS Code Node extension host. The browser extension host has different capabilities. Obtain the compiled extension and its host/version details before changing the loader.
- **Electron renderer module loading** - [https://github.com/standard-things/esm/issues/867](https://github.com/standard-things/esm/issues/867). The failing inline HTML script resolves `./renderer.js` from Electron's internal `renderer_init`, not necessarily from the application's page. The reported workaround mutates the injected `module` record and disables the cache. A safe fix would need explicit base-path semantics and tests across the relevant `nodeIntegration`, sandbox, and context-isolation settings. Modern isolated preload scripts are a separate migration option.
- **Electron dynamic imports and native-addon failures** - [https://github.com/standard-things/esm/issues/817](https://github.com/standard-things/esm/issues/817). **Node-side cache corruption fixed, Electron hang still unverified.** A real addon built for a different Node ABI rejects with `ERR_DLOPEN_FAILED` on Node 22, 24, and 26. Repeated imports exposed a separate defect: after an ESM re-export failed while requiring a native addon, a later import could reuse an incomplete CommonJS linking record and incorrectly return empty exports. The failed graph now discards only its incomplete staged CommonJS dependencies. Regression coverage exercises repeated and concurrent rejections in preload and factory modes with and without disk caching. The archived `crash.js` uses a valid `.catch(error => ...)` handler, unlike the abbreviated syntax in the issue description. The original Electron 5 process hang still requires a runnable Electron build with a mismatched addon to verify. Do not mark the host-specific failure resolved on Node-only evidence.
- **Electron renderer error stacks** - [https://github.com/standard-things/esm/issues/691](https://github.com/standard-things/esm/issues/691). Node loader exceptions are masked and the original `error.stack` is available, but the renderer's `window.onerror` and Chromium DevTools presentation are not verified. The existing stack-scrubbing path does not install a renderer event handler. Test the upstream renderer reproduction before introducing a DevTools-specific or source-map change.

### VM API boundary

- **Static imports in `vm.runInThisContext`** - [https://github.com/standard-things/esm/issues/886](https://github.com/standard-things/esm/issues/886). Reproduced on Node 22, 24, and 26. This API compiles script-goal code and does not accept static `import` declarations. Node's `vm.SourceTextModule` supports module-goal linking through a separate asynchronous API. Automatic transpilation or a new opt-in module evaluator would change the contract of the VM API and needs an explicit feature decision rather than a patch to ordinary `require()` hooks.

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
