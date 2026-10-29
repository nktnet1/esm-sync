# Upstream issue roadmap

Status as of 29 October 2026 for the 83 reports in
[`standard-things/esm`](https://github.com/standard-things/esm/issues).
The tests and source code, not a historical status label, are authoritative for
current behaviour. Keep an issue open when its exact integration has not been
verified. See [tooling and performance](tooling-and-performance.md) for evidence
on the two active application reproductions.

| Classification                                |  Count |
| --------------------------------------------- | -----: |
| Confirmed fixes still awaiting implementation |      0 |
| Investigate                                   |      8 |
| Documentation follow-ups                      |      4 |
| Already covered                               |     48 |
| Not planned                                   |     23 |
| **Total**                                     | **83** |

## Active investigations

### Application integrations

- [#810 - Babel aliases and top-level await](https://github.com/standard-things/esm/issues/810): **not resolved**. The canonical Acorn 8.19.0 production-test build passes the synthetic Babel output/preload-order tests in both cache modes. The original Express reproduction with `babel-plugin-module-resolver@3.2.0` and unchanged `.babelrc` still throws a top-level `await` syntax error when started through the canonical fork and `@babel/register`. An earlier run with an offline Acorn adapter appeared to wait correctly; it is not a substitute for the failing canonical path. Trace the extension-hook/module-goal decision, fix the original integration, and lock it with cold/warm regressions. The original `esm@3.2.25` can serve HTTP before its awaited two-second database initialization finishes.
- [#844 - Startup performance](https://github.com/standard-things/esm/issues/844): **not resolved**. The canonical production and production-test builds pass, and the historical pre-PR #140 Log4brains CLI works. Seven release-build `--version` trials measured a warm median of **1,705 ms** for the fork versus **1,651 ms** for original `esm@3.2.25`. Three paired release-build preview readiness runs favoured the fork, but three production-test pairs favoured original `esm`. Cold timings and the original loader's baseline varied substantially. Profile and measure controlled release-build startup before drawing a performance conclusion; the original reporter's private 10-to-30-second server workload is unavailable. Closure may require a documented decision to limit scope to the reproducible Log4brains application.

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

The following **48** reports are classified _already covered_ by an existing
fix, regression, supported behaviour, or documented boundary. That does not
certify every historical third-party application: reopen on a concrete failing
reproduction.

931, 926, 924, 922, 921, 918, 916, 914, 913, 910, 909, 904, 900, 898, 897,
896, 888, 887, 880, 879, 876, 875, 874, 872, 868, 866, 864, 863, 855, 852,
846, 843, 841, 839, 824, 821, 816, 813, 812, 809, 805, 798, 796, 794,
786, 779, 775, 706.

The following **23** reports are _not planned_: they concern external tooling,
obsolete environments, different products, unsupported feature requests, or
insufficient reproductions.

930, 929, 928, 927, 920, 919, 917, 907, 903, 893, 892, 890, 884, 869, 862,
861, 859, 845, 833, 829, 828, 791, 780.

For build, fixture, and compatibility-test commands, see the
[maintainer guide](MAINTAINER_GUIDE.md). Do not mark an investigation fixed
based solely on a synthetic test or a passing CLI startup.
