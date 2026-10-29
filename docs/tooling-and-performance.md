# Open tooling and performance investigations

This document retains verification of
[#810](https://github.com/standard-things/esm/issues/810) and the open startup
investigation for [#844](https://github.com/standard-things/esm/issues/844). Historical fixed
issues are classified in the [roadmap](FORK_ISSUES_ROADMAP.md); their actual
regression tests remain in `test/vitest/`.

## #844: Log4brains startup

### Known implementation changes

Bootstrap loads validated, correctly sliced V8 bytecode, replaces rejected
bytecode immediately, and memoizes absent package manifests. Ordinary
CommonJS modules skip unnecessary AST work and top-level-await wrappers. Tests
exercise cache validation and compiler behaviour without fragile timing
thresholds. None of these changes proves a fix for the original reporter's
private server, which reportedly increased from about 10 to 30 seconds.

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
[PR #140](https://github.com/thomvaill/log4brains/pull/140) removed `esm`.
`packages/global-cli/dist/index.js` uses original `esm@3.2.25` with
`mainFields: ["module", "main"]`. Both the original loader and the fork return
`1.0.2-alpha.4` for `--version` on Node 20.20.2.

Log4brains also exposed a CommonJS default-import problem in `tslib@2.2.0`.
The v1.0.6 fix supplies a default export to pseudo-ESM modules with named
exports; v1.0.7 avoids adding one to marker-only empty namespaces. Focused
interop tests, native CommonJS imports, and the real Log4brains CLI passed
with the canonical production build. The **full CI suite was not rerun**.

The supplied Acorn 8.19.0 sources include `src/state.js`; normal
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
versus **1,619 ms** (fork); it is not the published loader.

The original Log4brains `preview --no-open --port <port>` application was
benchmarked from process spawn to HTTP **200** at `/`. All twelve requests per
build variant succeeded (three cold and three warm pairs):

| Build              | Loader         | Cold readiness median | Warm readiness median |
| ------------------ | -------------- | --------------------: | --------------------: |
| Production release | Original `esm` |                 7,894 |                 7,494 |
| Production release | Fork           |                 5,476 |                 5,277 |
| Production-test    | Original `esm` |                 5,610 |                 6,246 |
| Production-test    | Fork           |                 6,640 |                 6,602 |

Release runs favoured the fork; production-test runs favoured original `esm`.
The unmodified original loader's timings changed substantially across
sessions, and three pairs per configuration cannot establish a reproducible
speedup or regression. The original private server graph is unavailable.

### Controlled release verification (v1.0.10)

The new `benchmark:log4brains` command runs the unchanged historical CLI through
its own `require("esm")` call. Each loader gets a separate staged bootstrap and
compiler cache. The wrapper passes the cache path to the factory itself:
`ESM_OPTIONS.cache` alone can be overridden by explicit factory/package options.
Cold runs remove both caches; warm runs use the preceding cold run's caches in
a fresh process. Cache-state assertions and identical response hashes are
required. All 82 pre-existing application cache files remained byte-identical.

Canonical Acorn **8.19.0**, built with Node **24.21.0**, produced the actual
production release used here: **520,474 bytes**, SHA-256
`239c874ac1fcc144e89b2f5b00d03b675f02851a7f8e9aed36f39dff05f75a0f`.
Application processes used Node **20.20.2** on Linux x64, pinned to one CPU.
No builds or test suites ran alongside the timing trials. Each workload ran
**ten paired iterations**, alternating original/fork order in both cold and
warm blocks: **80 measured processes** overall. OS filesystem caches were not
flushed; “cold” refers to loader caches. The original loader is `esm@3.2.25`.

| Workload               | Loader    | Cold median (ms) | Warm median (ms) |
| ---------------------- | --------- | ---------------: | ---------------: |
| CLI `--version`        | Original  |            3,537 |            1,397 |
| CLI `--version`        | Fork      |            3,292 |            1,459 |
| Preview HTTP readiness | Original  |            8,439 |            2,916 |
| Preview HTTP readiness | Fork      |            6,983 |            2,973 |

Median **paired** fork/original ratios were **0.940 cold / 1.051 warm** for the
CLI and **0.824 cold / 1.011 warm** for preview. Cold preview favoured the fork
in all ten pairs; warm preview favoured original in seven. These ratios are
medians of per-pair ratios, not ratios of the marginal medians above.

Preview measures spawn to the complete HTTP 200 body at `/`, from the child's
own ephemeral port. All response hashes matched. The child then exits normally
to flush cache metadata; shutdown is outside the readiness measurement. CPU
usage, peak RSS, and load averages accompany every sample. Warm preview RSS
was approximately **265.7–266.6 MiB** for original and **271.2–272.4 MiB** for the fork;
about **8.7 GiB** was free at completion. This was a shared host with fixed CPU
affinity, not a dedicated-machine or OS-cold benchmark.

Separate CPU-profile runs captured three warm CLI and two warm preview starts
per loader, plus their cold runs. Repeated fork profiles attribute roughly
**40–42%** of CLI and **24–25%** of preview self samples to loader frames.
Error construction (`src/error/construct-error.ts`), filesystem reads/stats,
V8 function compilation, and garbage collection recur across profiles. Error
construction alone accounts for about **2.3–3.3%** of warm fork self samples. These
are sampled primary-process costs, not timings of a proposed optimisation.
Investigate the CommonJS fallback's stack/error inspection and compilation costs
without changing observable hook behaviour; validate any change against both
workloads before claiming an improvement.

**#844 remains unresolved.** The controlled results support a cold-start benefit
for this Log4brains workload, with no corresponding warm-start benefit. They do
not verify the reporter's unavailable private 10-to-30-second server regression.
The raw timing samples, resource records, artifact hashes, and CPU profiles
accompany `v1.0.10-verification.zip`.

The complete canonical production-test Vitest suite passes on Linux with Node
24.21.0: **1,539 tests across 55 files**. Typechecking and the attached Biome
check also pass. This does not replace the remaining OS/Node CI matrix.

## #810: Babel aliases and top-level await

The original upstream Express repository is
[`ndabAP/esm-babel-plugin-module-resolver-issue`](https://github.com/ndabAP/esm-babel-plugin-module-resolver-issue).
Its unchanged `.babelrc` uses `babel-plugin-module-resolver@3.2.0` to resolve
`@routes/hello-world.route`. Its await-only `src/database.js` sleeps for two
seconds but has no imports/exports. Original `esm@3.2.25` on Node 20.20.2 calls
`listen()` before that timer completes; the verification observer rejects it.

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
shared; application sources are not rewritten. A preload observer counts the
actual database timer and its completion microtask, asserts exactly one
initialisation before `listen()`, and then checks HTTP 200 with `Hello world`.
Source hashes are checked before/after. All four physical entry paths run in
both preload orders with disabled, cold, and warm caches: **24 checks per runtime**.

The canonical production-test artifact passes on Node **22.23.4**, **24.21.0**,
and **26.12.0**, with matching native bridges. The production release passes the
same 24 checks on Node **24.21.0**. This is **96 successful original-application
checks** across the two build variants. Babel core/register/preset-env are
7.29.7; the resolver plugin remains 3.2.0.

**Boundary:** The native bridge installer targets Node 22 and later. On Node
20.20.2 the corrected loader recognises the await-only dependency but fails with
`ERR_ESM_SYNC_ASYNC_PENDING` because no matching timer/I/O bridge is installed.
It does not report successful readiness. The Babel/preload integration is fixed
within the supported native-bridge startup context; Node 20 timer-await support
has not been added.
