# Upstream issue roadmap

Status as of 31 October 2026 for the 83 reports in
[`standard-things/esm`](https://github.com/standard-things/esm/issues).
The tests and source code, not a historical status label, are authoritative for
current behaviour. Keep an issue open when its exact integration has not been
verified. See [tooling and performance](tooling-and-performance.md) for evidence
on the two application reproductions.
For the scoped host reports, see the [full/partial/not-implemented status table](host-integrations.md) and verification instructions.

| Classification                                |  Count |
| --------------------------------------------- | -----: |
| Confirmed fixes still awaiting implementation |      0 |
| Investigate                                   |      4 |
| Documentation follow-ups                      |      0 |
| Already covered                               |     57 |
| Not planned                                   |     22 |
| **Total**                                     | **83** |

## Verified application integration

- **Babel aliases and top-level await** - [https://github.com/standard-things/esm/issues/810](https://github.com/standard-things/esm/issues/810). **Fixed for the supported native-bridge startup path**. The physical root `esm.js`/`index.js` shims were not recognised as preloads because their metadata paths retained `dist/../`. Resolving those paths installs the same hooks as the generated entry. The unchanged original Express/Babel configuration passes checks for single database evaluation and database completion before `listen()`, followed by the expected HTTP response. Verification covers both preload orders and disabled/cold/warm caches. Timer awaits on Node 20 remain outside the native bridge's supported range and fail explicitly. This does not extend legacy timer-await support. See the [verification evidence](tooling-and-performance.md#babel-aliases-and-top-level-await).

- **Startup performance** - [https://github.com/standard-things/esm/issues/844](https://github.com/standard-things/esm/issues/844). **Resolved**. Canonical production builds verify the historical Log4brains CLI and complete preview HTTP readiness. v1.0.11 reduced repeated CommonJS stack checks and captured bytecode after initialisation. v1.0.12 reduces retained warm-cache compilation state while preserving cold compilation and bytecode capture. See the [release measurements](tooling-and-performance.md#lower-startup-memory-v1012).

## Verified custom REPL integration

- **Programmatic REPL static imports** - [https://github.com/standard-things/esm/issues/854](https://github.com/standard-things/esm/issues/854). **Fixed for the tested Node 22, 24, and 26 preload path**. An application's `repl.start()` does not enter the same startup branch as `node -i`. A one-time, lazy context hook now activates REPL compilation when the application first creates a server. Non-REPL `vm.createScript()` calls retain their normal behaviour, including after creating multiple REPL servers. Tests cover cached and uncached configurations, custom prompts, sloppy mode, isolated contexts, relative-file imports, repeated imports, and a second active server. This does not change arbitrary `vm` script evaluation or promise rejection handling in the Node REPL.

## Verified desktop hosts

- **Electron renderer module loading (#867)** and **VS Code extension-host ESM loading (#915)** are **resolved for the original Linux reproductions**. The supplied Arch Linux/Wayland run passed all six disabled/cold/warm host cases using Electron 8.0.0 and VS Code 1.66.2 under Xvfb. Electron greeted exactly once on the first page load and each of three reloads in every cache mode. VS Code activated the original extension, executed its command and allocated a valid port in every mode. VS Code checks use fresh host processes; UI Reload Window is not automated. See [host verification](host-integrations.md) and run `pnpm verify:hosts:docker` for the self-contained Docker path.

## Active investigations

### Electron and extension-host integrations

- **Electron dynamic imports and native-addon failures (#817)** - **Partially resolved; full USB case open.** The incomplete-CommonJS-cache correction has regression coverage. Actual Electron 5.0.6 also passes disabled/cold/warm checks using real minimal addons for ABIs 137 and 70, including repeated/concurrent imports, a rebuilt control and a responsive debugger. These controls also pass upstream esm and do not reproduce the USB-specific hang. A real USB 1.6.0 ABI-72 build also crashes ordinary require without esm, so that native build cannot establish a loader-specific failure. Do not close the full issue on the minimal controls. See [scope and evidence](host-integrations.md#electron-dynamic-imports-and-native-addons-817).
- **Electron renderer error stacks (#691)** - **Resolved for the recreated Electron 8 failure.** Captured frames alone were insufficient: Chromium still reported the outer loader rethrow. Renderer errors now leave that boundary through a source-mapped function at their original location, preserving the error object. Actual window events, console output and DevTools exception locations pass for syntax and runtime errors in disabled/cold/warm modes, followed by a healthy reload. The deleted original application and its historical Electron version remain unavailable. See [reconstruction and verification](host-integrations.md#chromium-error-presentation-691).

### Embedded VM hosts

- **StackBlitz/WebContainers (#917)** - **Partially resolved.** The shared-intrinsic guard fixes live-global corruption in native regressions across cache modes. A real WebContainer on Node 22.22.3 loads a smoke module with the published fork and retains Object; upstream esm fails that smoke load. The guard was applied to an isolated test package, but the full historically failing application path was not established. Preserve this distinction before closing the issue. See [scope and evidence](host-integrations.md#shared-realm-vm-emulation-917).

### VM API boundary

- **Static imports in `vm.runInThisContext`** - [https://github.com/standard-things/esm/issues/886](https://github.com/standard-things/esm/issues/886). **Not implemented: API boundary.** Reproduced on Node 22, 24, and 26, including the supplied probe. This API compiles script-goal code and does not accept static `import` declarations. Use the existing loader factory for the supplied file, or Node's separate `vm.SourceTextModule` API with an explicit linker. See [supported alternatives](host-integrations.md#static-imports-in-vm-scripts-886). Automatic transpilation of arbitrary VM scripts remains a separate feature decision.

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

The following **57** reports are classified _already covered_ by an existing
fix, regression, supported behaviour, or documented boundary. That does not
certify every historical third-party application: reopen on a concrete failing
reproduction.

931, 926, 924, 922, 921, 918, 916, 915, 914, 913, 910, 909, 904, 900, 898, 897,
896, 888, 887, 885, 880, 879, 876, 875, 874, 873, 872, 868, 867, 866, 865, 864, 863, 855, 854, 852,
846, 844, 843, 841, 839, 838, 824, 821, 816, 813, 812, 810, 809, 805, 798, 796, 794,
786, 779, 775, 706.

The following **22** reports are _not planned_: they concern external tooling,
obsolete environments, different products, unsupported feature requests, or
insufficient reproductions.

930, 929, 928, 927, 920, 919, 907, 903, 893, 892, 890, 884, 869, 862,
861, 859, 845, 833, 829, 828, 791, 780.

For build, fixture, and compatibility-test commands, see the
[maintainer guide](MAINTAINER_GUIDE.md). Do not mark an investigation fixed
based solely on a synthetic test or a passing CLI startup.
