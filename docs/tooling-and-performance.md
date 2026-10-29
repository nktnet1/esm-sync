# Tooling and performance verification

This document retains verification of the
[Babel integration](#babel-aliases-and-top-level-await) and the resolved
[Log4brains startup report](#log4brains-startup-resolved). Historical fixed
issues are classified in the [roadmap](FORK_ISSUES_ROADMAP.md). Their actual
regression tests remain in `test/vitest/`.

## Log4brains startup (resolved)

Upstream report: [https://github.com/standard-things/esm/issues/844](https://github.com/standard-things/esm/issues/844).

### Known implementation changes

Bootstrap loads validated, correctly sliced V8 bytecode, replaces rejected
bytecode immediately, and memoizes absent package manifests. Ordinary
CommonJS modules skip unnecessary AST work and top-level-await wrappers. Tests
exercise cache validation and compiler behaviour without fragile timing
thresholds. Controlled release measurements verify the Log4brains startup
improvements described below.

`pnpm benchmark:startup` measures synthetic graphs or a terminating application
entry, not live-server HTTP readiness. For example:

```sh
pnpm benchmark:startup --modules=256 --iterations=7 --json
pnpm benchmark:startup --entry=/path/to/log4brains/packages/global-cli/dist/index.js --cwd=/path/to/log4brains --iterations=7 --json -- --version
```

`--loader` selects a built baseline, and `--node-arg` forwards a Node flag to
both sides. Child processes clear inherited `NODE_OPTIONS`. Do not treat
synthetic graphs or `--version` as a substitute for a server-readiness test.

### Original application and canonical build (v1.0.8 verification)

The provided historical Log4brains workspace is commit
`68f80982fc0d2007acc2f8e08f27b2e6f974cec8`, immediately before
[https://github.com/thomvaill/log4brains/pull/140](https://github.com/thomvaill/log4brains/pull/140) removed `esm`.
`packages/global-cli/dist/index.js` uses original `esm@3.2.25` with
`mainFields: ["module", "main"]`. Both the original loader and the fork return
`1.0.2-alpha.4` for `--version` on Node 20.20.2.

Log4brains also exposed a CommonJS default-import problem in `tslib@2.2.0`.
The v1.0.6 fix supplies a default export to pseudo-ESM modules with named
exports. v1.0.7 avoids adding one to marker-only empty namespaces. Focused
interop tests, native CommonJS imports, and the real Log4brains CLI passed
with the canonical production build. The **full CI suite was not rerun**.

The supplied Acorn 8.19.0 sources include `src/state.js`. Normal
`setup-fixtures acorn` and both canonical build commands passed without the
previous temporary Acorn adapter, on Node 24.21.0:

| Build                 | `dist/esm/loader.js` size | SHA-256                                                            |
| --------------------- | ------------------------: | ------------------------------------------------------------------ |
| `build --prod --test` |             520,813 bytes | `5b1da74647596f874101b4a4a4f4db9fb05d5d6727f3b8c49eb169e52da9b750` |
| `build --prod`        |             520,495 bytes | `f5cde620400472b630d1726cc1beab266ba9ad70e2db09f13c212ef126bba19d` |

### Historical v1.0.8 measurements (Node 20.20.2, milliseconds)

Seven paired `--version` trials, original `esm@3.2.25` versus the canonical
**release** fork, measured:

| Loader         | Cold median | Warm median |
| -------------- | ----------: | ----------: |
| Original `esm` |       2,295 |       1,651 |
| Release fork   |       2,932 |       1,705 |

The release fork's warm median was approximately **3% slower**, while cold
results varied with execution order and are not a reliable performance ratio.
The production-test build had a separate warm result of **1,513 ms** (original)
versus **1,619 ms** (fork). It is not the published loader.

The original Log4brains `preview --no-open --port <port>` application was
benchmarked from process spawn to HTTP **200** at `/`. All twelve requests per
build variant succeeded (three cold and three warm pairs):

| Build              | Loader         | Cold readiness median | Warm readiness median |
| ------------------ | -------------- | --------------------: | --------------------: |
| Production release | Original `esm` |                 7,894 |                 7,494 |
| Production release | Fork           |                 5,476 |                 5,277 |
| Production-test    | Original `esm` |                 5,610 |                 6,246 |
| Production-test    | Fork           |                 6,640 |                 6,602 |

Release runs favoured the fork. Production-test runs favoured original `esm`.
The unmodified original loader's timings changed substantially across
sessions, and three pairs per configuration cannot establish a reproducible
speedup or regression.

### Warm CommonJS startup (v1.0.11)

The earlier parser/bootstrap work mostly helped cache misses. Warm CommonJS
startup still repeated an error-stack inspection for nested native loads, and
`compileFunction.cachedData` was generated before module execution. That cache
could not retain helper functions compiled during module initialisation.

The new release makes two changes:

- Reuse a successful external-caller stack check while its synchronous native
  fallback remains active. `finally` clears the decision on return or failure.
  A call without a known external caller still gets its own stack inspection.
- Use a wrapped `vm.Script` for persistent CommonJS bytecode when
  `createCachedData` is available. Cache creation/repair then captures bytecode
  after execution. Uncached function compilation avoids producing unused
  bytecode. A separate wrapper line and `lineOffset: -1` preserve native runtime
  columns and SyntaxError source/caret output, including the first source line.

A separate instrumented CLI run counted **1,334 → 133** internal error
constructions in both cold and warm runs. These counters verify removed work.
The instrumented timings are excluded from the performance results below.

### Controlled release measurements

`benchmark:log4brains` invokes the unchanged historical CLI's own
`require("esm")`. Every loader has private bootstrap/compiler caches, with the
cache path supplied to its factory. Cold runs remove both caches. Warm runs
reuse the preceding cold run's caches in fresh processes. Loader order
alternates, cache state is asserted, and all version outputs/HTTP body hashes
must match. OS filesystem caches are not flushed.

The canonical Acorn **8.19.0** release was built on Node **24.21.0**:
**520,696 bytes**, SHA-256
`ff9cbfccb59e9111596556377685e65ed163e9c9f81f6aacace97316182a6f6d`.
Application processes used Node **20.20.2**, Linux x64, pinned to one CPU. No
builds or tests ran alongside timing trials. Each comparison/workload used ten
paired iterations, giving **160 measured processes** for the final release.

| Baseline              | Workload        | Baseline cold (ms) | v1.0.11 cold (ms) | Baseline warm (ms) | v1.0.11 warm (ms) |
| --------------------- | --------------- | -----------------: | ----------------: | -----------------: | ----------------: |
| v1.0.10 fork          | CLI `--version` |              3,351 |             3,260 |              1,455 |             1,268 |
| v1.0.10 fork          | Preview HTTP    |              6,953 |             6,692 |              3,026 |             2,584 |
| Original `esm@3.2.25` | CLI `--version` |              3,622 |             3,354 |              1,419 |             1,395 |
| Original `esm@3.2.25` | Preview HTTP    |              8,256 |             6,773 |              2,835 |             2,583 |

These are marginal medians from separate batches. The primary comparison uses
medians of each matched pair's fork/baseline ratio:

| Baseline       | Workload | Cold ratio | Warm ratio | Warm pairs favouring v1.0.11 |
| -------------- | -------- | ---------: | ---------: | ---------------------------: |
| v1.0.10        | CLI      |      0.980 |      0.857 |                       9 / 10 |
| v1.0.10        | Preview  |      0.983 |      0.881 |                      10 / 10 |
| Original `esm` | CLI      |      0.883 |      0.939 |                       6 / 10 |
| Original `esm` | Preview  |      0.823 |      0.902 |                       9 / 10 |

Against v1.0.10, median paired warm startup improved **14.3% for CLI** and
**11.9% for preview**. Warm preview improved **9.8%** against original `esm`.
The original-loader CLI result remains variable: six of ten warm pairs favoured
the fork, so do not claim a dependable CLI speedup over original `esm`.

Preview measures spawn to the complete HTTP 200 body at `/` from the child's
own ephemeral port, followed by normal exit to flush caches. Shutdown is outside
HTTP readiness. Resource records accompany every sample. The warmed preview's
recorded startup peak RSS increased from roughly **271–272 MiB** in v1.0.10 to
**305–307 MiB** in v1.0.11, about **35 MiB extra**. RSS is captured before the
exit-time cache writer. This trades additional cache memory for lower startup
latency. It is a shared-host measurement with fixed CPU affinity.

An explicit upgrade check reused a populated v1.0.10 cache in the same package
path. The new bootstrap and **1,347 CommonJS entries** rejected the older
bytecode and rebuilt successfully. The next run accepted all 1,347 CommonJS
entries with zero rejections. Source changes are not required to repair caches.

The final source passes **1,543 Vitest tests across 55 files** on Linux/Node
24.21.0, plus typechecking and the attached Biome check. The unchanged original
Babel application also passes all 96 checks again: production-test on Node
22/24/26 and release on Node 24. This does not replace the full OS/Node CI matrix.

**The startup report is resolved.** The historical Log4brains application has a measured
warm-start improvement, with
the memory tradeoff above. Raw trials, diagnostic counters, upgrade checks,
runtime bytes/hashes, and validation logs accompany
`v1.0.11-startup-verification.zip`.

### Lower startup memory (v1.0.12)

The release reduces retained CommonJS compilation state:

- Accepted bytecode is omitted from the exit-time Script queue. Missing and
  rejected bytecode stays queued for creation or repair. Mixed warm/missing
  caches preserve the valid older entries when rewritten.
- After accepted untransformed CommonJS bytecode executes, release the separate
  raw source text held by its entry/compiler cache. V8 retains the compiled
  source for execution and stack traces. Cold compilation and bytecode capture
  remain unchanged. Transformed CommonJS and ESM source remains available for
  persistence, linking, and source-cache recovery.

The canonical Acorn **8.19.0** production release is **520,838 bytes**, SHA-256
`2456eab7ef250609ca47636e4a17e346995625f9819950517428b33d5999b384`.
The final source passes **1,547 Vitest tests across 56 files** on Node 24.21.0
and typechecking. The unchanged original Babel application passes **96 checks**:
production-test on Node 22/24/26 and production release on Node 24. This includes
both preload orders, disabled/cold/warm caches, one database evaluation, and
database completion before HTTP readiness. These checks supplement the OS/Node
CI matrix.


Final comparisons use the same unchanged application and private-cache harness
as v1.0.11: Node 20.20.2, Linux x64, CPU 2, alternating loader order and fresh
processes. Each workload/cache state has ten paired trials, **80 complete
measured processes** in total. No builds, tests, or diagnostic instrumentation
ran alongside these timings. All CLI outputs and complete HTTP body hashes
match. OS filesystem caches are not flushed.

| Workload     | Cache | v1.0.11 median (ms) | v1.0.12 median (ms) | Median paired v1.0.12/v1.0.11 ratio |
| ------------ | ----- | ------------------: | ------------------: | ----------------------------------: |
| CLI          | Cold  |               5,745 |               5,785 |                               0.991 |
| CLI          | Warm  |               2,372 |               2,323 |                               0.985 |
| Preview HTTP | Cold  |              12,354 |              12,063 |                               1.043 |
| Preview HTTP | Warm  |               4,772 |               4,777 |                               1.021 |

| Workload     | Cache | v1.0.11 median peak RSS (MiB) | v1.0.12 median peak RSS (MiB) | Median paired RSS change (MiB) |
| ------------ | ----- | ----------------------------: | ----------------------------: | -----------------------------: |
| CLI          | Cold  |                         248.8 |                         248.6 |                          -0.02 |
| CLI          | Warm  |                         172.7 |                         169.5 |                           -2.8 |
| Preview HTTP | Cold  |                         549.7 |                         549.8 |                           +0.4 |
| Preview HTTP | Warm  |                         315.3 |                         306.1 |                           -9.1 |

Warm peak RSS is lower in **all ten CLI pairs and all ten HTTP pairs**. The
latency results are mixed: the paired median is 1.5% faster for warm CLI and
2.1% slower for warm HTTP. Only five/four of ten warm pairs respectively favour
the new build. Cold HTTP's paired median is 4.3% slower. **No dependable
additional startup speedup is established.** Marginal medians and median
paired ratios are different statistics. Do not combine these batches with
older measurements to infer a memory or latency change.

RSS is recorded before the exit-time cache writer, as in the earlier harness.
The repeatable result here is lower retained warm-start memory. Cold source
compilation and bytecode capture are preserved by the implementation. Their
measured timings remain subject to shared-host variability.

A larger shared-generator prototype reduced memory but regressed warm HTTP
readiness by 18.5% in paired medians and was rejected. Manifest deduplication
and streamed cache-key hashing also increased RSS in their exploratory batch
and were dropped. The final patch contains only accepted-cache queue/source
retention changes. The archive retains the exploratory reports separately.
An incomplete CLI run produced no report. Its replacement complete batch is
included in full.

A separate CLI diagnostic counted **1,388 queued compiler Scripts → 0** and
**7,403,482 compiler-cache raw CommonJS source characters → 0** on warm
startup. Both cold runs retained the same 1,388 Scripts and 7,403,482 raw
source characters. Diagnostic timings are excluded from the trial tables.

The upgrade check accepts all **1,347 existing CommonJS bytecode entries** with
zero rejections, both immediately after upgrade and on the next warm run.
Regression tests cover untouched warm blobs, mixed warm/missing entries,
corrupt-entry repair, single evaluation, transformed-source loss/recovery, and
native error locations. Raw reports, exact runtime bytes, hashes, analysis,
retention diagnostics and validation logs accompany
`v1.0.12-startup-verification.zip`.

## Babel aliases and top-level await

Upstream report: [https://github.com/standard-things/esm/issues/810](https://github.com/standard-things/esm/issues/810).

The original upstream Express repository is
[`ndabAP/esm-babel-plugin-module-resolver-issue`](https://github.com/ndabAP/esm-babel-plugin-module-resolver-issue).
Its unchanged `.babelrc` uses `babel-plugin-module-resolver@3.2.0` to resolve
`@routes/hello-world.route`. Its await-only `src/database.js` sleeps for two
seconds but has no imports/exports. Original `esm@3.2.25` on Node 20.20.2 calls
`listen()` before that timer completes. The verification observer rejects it.

### Root cause and fix (v1.0.10)

Canonical Acorn module-goal detection and Babel's extension hooks were already
working when preloading `dist/esm.js`. The failing path was the physical root
`esm.js` shim (also `index.js`). Runtime package metadata concatenated its path
as `dist/../esm.js`, while Node reported the normalised filename. The exact
preload comparison failed, so the loader never installed its hooks. Babel then
converted imports to CommonJS and handed the await-only database file to Node's
CommonJS compiler, producing the reported `SyntaxError`.

Resolve the package filenames against `dist/` before comparing them. No Babel
configuration changes, Acorn adapter, or module-goal workaround is required.
Regression tests exercise physical shims, preserved/CommonJS Babel output,
factory/direct entry launches, preload order, and cache transitions.

### Original-application verification

`pnpm verify:babel-repro --project=/path/to/installed/repro --node=/path/to/node --json`
uses byte-identical copies of the original configuration and application files,
with private package, bootstrap, and Babel caches. Installed dependencies are
shared. Application sources are not rewritten. A preload observer counts the
actual database timer and its completion microtask, asserts exactly one
initialisation before `listen()`, and then checks HTTP 200 with `Hello world`.
Source hashes are checked before/after. All four physical entry paths run in
both preload orders with disabled, cold, and warm caches: **24 checks per runtime**.

The canonical production-test artifact passes on Node **22.23.4**, **24.21.0**,
and **26.12.0**, with matching native bridges. The production release passes the
same 24 checks on Node **24.21.0**. This is **96 successful original-application
checks** across the two build variants. Babel core/register/preset-env are
7.29.7. The resolver plugin remains 3.2.0.

**Boundary:** The native bridge installer targets Node 22 and later. On Node
20.20.2 the corrected loader recognises the await-only dependency but fails with
`ERR_ESM_SYNC_ASYNC_PENDING` because no matching timer/I/O bridge is installed.
It does not report successful readiness. The Babel/preload integration is fixed
within the supported native-bridge startup context. Node 20 timer-await support
has not been added.
