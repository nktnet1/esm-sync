# Open tooling and performance investigations

This document retains only the evidence and next steps required to resolve
upstream [#810](https://github.com/standard-things/esm/issues/810) and
[#844](https://github.com/standard-things/esm/issues/844). Historical fixed
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

### Benchmarks (Node 20.20.2, milliseconds)

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

**Next:** Benchmark the release build under a controlled, isolated environment
with more alternating, paired trials, explicit cold/warm cache isolation, and
steady-state resource checks. Profile a repeatable warm-startup bottleneck
before making code changes. If the original private server remains unavailable,
explicitly decide whether the issue's scope may be closed against the
reproducible Log4brains workload only. Do not claim the private 10-to-30-second
report has been verified.

The detailed evidence is available outside the repository in
`issue-844-canonical-verification-results.json` and
`issue-844-canonical-raw-benchmarks.zip`; attach them in a new work session.

## #810: Babel aliases and top-level await

The original upstream Express repository is
[`ndabAP/esm-babel-plugin-module-resolver-issue`](https://github.com/ndabAP/esm-babel-plugin-module-resolver-issue).
Its `babel-plugin-module-resolver@3.2.0` configuration resolves
`@routes/hello-world.route`. Its await-only `src/database.js` sleeps for two
seconds but has no imports/exports. Original `esm@3.2.25` can serve the route
before the database completes, so an HTTP 200 response alone is **not** a
correctness test.

The fork has targeted changes for await-only module classification, transformed
source cache keys, and cross-factory await markers. Installed Babel regression
fixtures cover `@babel/register` with CommonJS and preserved-ESM output,
preload order, direct entry launches, cold/warm caches, and transform changes.
The canonical Acorn production-test build passed both cached and uncached
synthetic Babel tests.

**Still failing:** When the **unchanged original** `.babelrc` is run through
the canonical fork with `@babel/register`, the await-only database source is
sent to Node's CommonJS compiler and throws a top-level-await `SyntaxError`.
Earlier results from a temporary Acorn build adapter succeeded with both
preload orders; they do not override the real canonical failure.

**Next:** Trace the exact installed extension-hook ordering and transformed
module-goal detection for the original reproduction. Confirm both preload
orders, database completion before HTTP readiness, single execution, and
cold/warm caches with the canonical release/test builds. Investigate Node 20
await-bridge availability separately; success with the Node 24 native bridge
does not establish the same capability on Node 20. Add an original-reproduction
regression before marking #810 resolved.
