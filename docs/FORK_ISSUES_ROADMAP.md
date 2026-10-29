# Upstream issue roadmap

Status as of 30 October 2026 for the 83 reports in
[`standard-things/esm`](https://github.com/standard-things/esm/issues).
The tests and source code, not a historical status label, are authoritative for
current behaviour. Keep an issue open when its exact integration has not been
verified. See [tooling and performance](tooling-and-performance.md) for evidence
on the two active application reproductions.

| Classification                                |  Count |
| --------------------------------------------- | -----: |
| Confirmed fixes still awaiting implementation |      0 |
| Investigate                                   |      7 |
| Documentation follow-ups                      |      4 |
| Already covered                               |     49 |
| Not planned                                   |     23 |
| **Total**                                     | **83** |

## Verified application integration

- [#810 - Babel aliases and top-level await](https://github.com/standard-things/esm/issues/810): **fixed for the supported native-bridge startup path**. The physical root `esm.js`/`index.js` shims were not recognised as preloads because their metadata paths retained `dist/../`. Resolving those paths installs the same hooks as the generated entry. The unchanged original Express/Babel configuration passes checks for single database evaluation and database completion before `listen()`, followed by the expected HTTP response. Verification covers both preload orders and disabled/cold/warm caches. Timer awaits on Node 20 remain outside the native bridge's supported range and fail explicitly; this does not extend legacy timer-await support. See the [verification evidence](tooling-and-performance.md#810-babel-aliases-and-top-level-await).

## Active investigations

### Application integrations

- [#844 - Startup performance](https://github.com/standard-things/esm/issues/844): **open for the private reporter workload**. v1.0.11 reduces repeated CommonJS stack checks and captures persistent bytecode after initialisation. Ten paired final-release trials per workload measured **14.3% faster warm CLI** and **11.9% faster warm preview** than v1.0.10; preview improved **9.8%** against original `esm@3.2.25`, winning nine of ten warm pairs. The original-loader CLI comparison remains variable. Warm preview startup peak RSS increased by about **35 MiB** versus v1.0.10. The private 10-to-30-second server is still unavailable, so its regression has not been verified. See [current controlled evidence](tooling-and-performance.md#controlled-release-measurements).

### Host-specific reports needing a reproduction or scope decision

- [#915](https://github.com/standard-things/esm/issues/915): VS Code extension-host ESM loading.
- [#867](https://github.com/standard-things/esm/issues/867): Electron renderer module loading.
- [#817](https://github.com/standard-things/esm/issues/817): Electron dynamic imports versus native-addon failures.
- [#691](https://github.com/standard-things/esm/issues/691): Electron renderer error stacks.
- [#854](https://github.com/standard-things/esm/issues/854): Custom REPL import hooks.
- [#886](https://github.com/standard-things/esm/issues/886): `vm.runInThisContext` is script-goal; module loading there would be a separate feature.

## Documentation follow-ups

- [#885](https://github.com/standard-things/esm/issues/885): Explain `cjs.dedefault` with an example.
- [#873](https://github.com/standard-things/esm/issues/873): Document Mocha preloads versus a setup-file loader factory.
- [#865](https://github.com/standard-things/esm/issues/865): Explain global-reference rewriting for contributors.
- [#838](https://github.com/standard-things/esm/issues/838): Provide native Node ESM migration guidance.

## Triaged, not currently actionable

The following **49** reports are classified _already covered_ by an existing
fix, regression, supported behaviour, or documented boundary. That does not
certify every historical third-party application: reopen on a concrete failing
reproduction.

931, 926, 924, 922, 921, 918, 916, 914, 913, 910, 909, 904, 900, 898, 897,
896, 888, 887, 880, 879, 876, 875, 874, 872, 868, 866, 864, 863, 855, 852,
846, 843, 841, 839, 824, 821, 816, 813, 812, 810, 809, 805, 798, 796, 794,
786, 779, 775, 706.

The following **23** reports are _not planned_: they concern external tooling,
obsolete environments, different products, unsupported feature requests, or
insufficient reproductions.

930, 929, 928, 927, 920, 919, 917, 907, 903, 893, 892, 890, 884, 869, 862,
861, 859, 845, 833, 829, 828, 791, 780.

For build, fixture, and compatibility-test commands, see the
[maintainer guide](MAINTAINER_GUIDE.md). Do not mark an investigation fixed
based solely on a synthetic test or a passing CLI startup.
