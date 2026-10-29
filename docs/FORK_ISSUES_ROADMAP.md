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
| Investigate                                   |      6 |
| Documentation follow-ups                      |      0 |
| Already covered                               |     54 |
| Not planned                                   |     23 |
| **Total**                                     | **83** |

## Verified application integration

- **Babel aliases and top-level await** - [https://github.com/standard-things/esm/issues/810](https://github.com/standard-things/esm/issues/810). **Fixed for the supported native-bridge startup path**. The physical root `esm.js`/`index.js` shims were not recognised as preloads because their metadata paths retained `dist/../`. Resolving those paths installs the same hooks as the generated entry. The unchanged original Express/Babel configuration passes checks for single database evaluation and database completion before `listen()`, followed by the expected HTTP response. Verification covers both preload orders and disabled/cold/warm caches. Timer awaits on Node 20 remain outside the native bridge's supported range and fail explicitly. This does not extend legacy timer-await support. See the [verification evidence](tooling-and-performance.md#babel-aliases-and-top-level-await).

- **Startup performance** - [https://github.com/standard-things/esm/issues/844](https://github.com/standard-things/esm/issues/844). **Resolved**. Canonical production builds verify the historical Log4brains CLI and complete preview HTTP readiness. v1.0.11 reduced repeated CommonJS stack checks and captured bytecode after initialisation. v1.0.12 reduces retained warm-cache compilation state while preserving cold compilation and bytecode capture. See the [release measurements](tooling-and-performance.md#lower-startup-memory-v1012).

## Active investigations

### Host-specific reports needing a reproduction or scope decision

- VS Code extension-host ESM loading. Upstream report: [https://github.com/standard-things/esm/issues/915](https://github.com/standard-things/esm/issues/915).
- Electron renderer module loading. Upstream report: [https://github.com/standard-things/esm/issues/867](https://github.com/standard-things/esm/issues/867).
- Electron dynamic imports versus native-addon failures. Upstream report: [https://github.com/standard-things/esm/issues/817](https://github.com/standard-things/esm/issues/817).
- Electron renderer error stacks. Upstream report: [https://github.com/standard-things/esm/issues/691](https://github.com/standard-things/esm/issues/691).
- Custom REPL import hooks. Upstream report: [https://github.com/standard-things/esm/issues/854](https://github.com/standard-things/esm/issues/854).
- `vm.runInThisContext` is script-goal. Module loading there would be a separate feature. Upstream report: [https://github.com/standard-things/esm/issues/886](https://github.com/standard-things/esm/issues/886).

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

The following **54** reports are classified _already covered_ by an existing
fix, regression, supported behaviour, or documented boundary. That does not
certify every historical third-party application: reopen on a concrete failing
reproduction.

931, 926, 924, 922, 921, 918, 916, 914, 913, 910, 909, 904, 900, 898, 897,
896, 888, 887, 885, 880, 879, 876, 875, 874, 873, 872, 868, 866, 865, 864, 863, 855, 852,
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
