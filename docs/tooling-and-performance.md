# Tooling and performance

The integration fixtures run in real Node subprocesses in
`test/vitest/fork-tooling-performance.test.ts` and
`test/vitest/tooling-original-reproductions.test.ts`. CI runs these files in the
**tooling** project on Ubuntu/Node 24. The installed Jest version is **26.6.3**;
the installed protobufjs version used by the regression is **7.6.6**.

## What the previous patch fixed (v1.0.3)

- **#779:** The executing Jest realm's intrinsic eval retains lexical `require`
  for protobuf-style optional filesystem discovery; custom eval stays intact.
- **#875 / #706:** The package supplies Jest `process` / `getCacheKey` methods,
  preserves configured globals and lexical `jest`, and supports cold/warm
  transform caches and changed dependencies with installed Jest 26.
- **#844, partially:** Bootstrap uses its own bytecode slice, rejects invalid
  metadata, replaces rejected V8 bytecode immediately, and memoizes missing
  package manifests. The benchmark gained graph sizing and loader selection.

That patch also tested a small Babel alias-rewrite fixture with preserved ESM.
It did not run the original module-resolver package or a full Log4brains CLI.

## Validation (v1.0.4)

Local validation used the supplied Biome binary and the full TypeScript checks.
On Linux/Node 24.21.0, development and production builds each passed all 54 test
files and 1,531 tests. The compiler, top-level await, tooling, and original-report
regression files also passed all 115 checks on Node 22.23.4 and Node 26.12.0 in
both build modes, with each runtime's native await bridge built.

## Startup and compiler caches (#844)

Bootstrap reads the `esm` record's validated offsets from `.data.json` before
passing its slice of `.data.blob` to V8. Other modules' bytecode, a prefix, or a
suffix must not be passed as the bootstrap's cached data. When V8 rejects
bytecode, the cache writer now generates replacement bytecode in that same
process, so the next process can reuse it. Missing package manifests are also
memoized during resolution, avoiding repeated reads while walking a graph.

Regression tests copy the package into a private directory, place bootstrap
bytecode inside a larger blob, corrupt the bytecode, and exercise malformed or
missing metadata and `ESM_DISABLE_CACHE`. They assert actual cache consumption,
rejection, regeneration, and subsequent acceptance, without timing thresholds.

Build before measuring:

```sh
pnpm benchmark:startup --modules=256 --iterations=7 --json
pnpm benchmark:startup --modules=256 --iterations=7 --loader=/path/to/baseline/dist/esm.js --json
```

`--modules` accepts 1–1000 modules; the default remains 16. `--loader` selects a
built loader and defaults to this checkout. The report identifies its canonical
path, Node version, platform, graph size, individual samples, and medians.

Each iteration loads equivalent `.mjs` and `.js` graphs in fresh subprocesses:

- **native:** Native Node, without the loader.
- **esmCold:** esm-sync with an empty application compiler cache.
- **esmWarm:** esm-sync reusing that iteration's application compiler cache.

The bootstrap cache is separate and may already be warm in either loader case.
Times include Node startup, application execution, and cache writes on exit.
The script checks the graph's result, verifies cache creation, and cleans up.

An illustrative development-build comparison on Linux/Node 24.21.0, using the
same host, 256-module graph, and seven iterations per build, produced these
medians in milliseconds:

| Build               | Native | esmCold | esmWarm |
| ------------------- | -----: | ------: | ------: |
| Supplied `08490c57` | 102.46 |  368.38 |  264.04 |
| v1.0.3 cache fixes  |  91.90 |  322.88 |  217.80 |

The changing native baseline demonstrates measurement noise. These figures are
not CI thresholds or a promised speedup. The original application's reported
10-to-30-second regression still needs its application graph and equivalent
before/after measurements; fixing these cache faults does not establish that
application's startup time.

## CommonJS loading and application measurements (v1.0.4)

Ordinary CommonJS `require` calls do not need source rewriting. The compiler now
returns those scripts without constructing an AST when no import, export,
eval, or await candidate is present. With the legacy `await` option enabled,
only scripts with actual top-level await get an async wrapper; ordinary
CommonJS dependencies no longer allocate a wrapper promise for that option.
Script bindings named `await`, strings/comments, and nested async functions have
regression coverage against the intended script/module goals.

An illustrative Linux/Node 24.21.0 development-build comparison loaded the
installed **Execa 5.1.1 dependency graph**, which is within Log4brains' declared
Execa range, with `await: true`. Nine iterations per build produced these
medians in milliseconds:

| Build                         | Native | esmCold | esmWarm |
| ----------------------------- | -----: | ------: | ------: |
| v1.0.3                        |  69.45 |  146.37 |  117.51 |
| v1.0.4 CommonJS/cache changes |  73.87 |  131.72 |  120.47 |

These measure that dependency graph. They do not establish a full Log4brains
startup result or a consistent warm-start improvement.

The benchmark now also accepts an existing, built application entry:

```sh
pnpm benchmark:startup --entry=/path/to/log4brains/packages/global-cli/dist/index.js --cwd=/path/to/log4brains --node-arg=--openssl-legacy-provider --iterations=7 --json -- --version
```

`--entry` / `--cwd` select canonical existing paths; arguments after `--` reach
the application. Repeat `--node-arg` for Node runtime flags needed in both the
native and loader cases. `--await` enables the legacy loader option for a
comparison. Existing `NODE_OPTIONS` are cleared in child processes so an
inherited loader cannot contaminate the native baseline. Child exit status and
matching stdout are checked; use a deterministic, terminating CLI command such
as `--help` or `--version`. A live server/readiness benchmark is not implemented.

### Historical Log4brains application (v1.0.6; canonical verification v1.0.8)

The **built** Log4brains workspace from commit
`68f80982fc0d2007acc2f8e08f27b2e6f974cec8`, immediately before PR #140
removed `esm`, contains the original CLI bootstrap at
`packages/global-cli/dist/index.js`. It calls `require("esm")(module, {
mainFields: ["module", "main"] })`. The comparison changes only that loader
reference in an adjacent bootstrap copy, retaining the same application,
dependency graph, and `mainFields` option. Both loaders return
`1.0.2-alpha.4` for `--version` on Node 20.20.2.

The initial experiment (v1.0.6) used a temporary offline Acorn adapter.
Eleven alternating cold/warm `--version` pairs had the following medians
(in milliseconds); these are **not** production-build evidence:

| Loader                             | Cold CLI | Warm CLI |
| ---------------------------------- | -------: | -------: |
| Original `esm@3.2.25`              |  2,999.9 |  1,470.0 |
| Fork (offline Acorn build adapter) |  2,738.9 |  1,650.4 |

**Canonical-build verification:** The supplied test-fixtures archive contains
the real Acorn `8.19.0` repository sources, including `src/state.js`. The
unmodified `setup-fixtures acorn` task reports the sources are prepared. On
Node 24.21.0, both standard commands, `build --prod --test` and `build --prod`,
completed **without** an Acorn adapter or local bundler overrides:

| Build              | `dist/esm/loader.js` bytes | SHA-256                                                            |
| ------------------ | -------------------------: | ------------------------------------------------------------------ |
| Production-test    |                    520,813 | `5b1da74647596f874101b4a4a4f4db9fb05d5d6727f3b8c49eb169e52da9b750` |
| Production release |                    520,495 | `f5cde620400472b630d1726cc1beab266ba9ad70e2db09f13c212ef126bba19d` |

The `tslib` interoperability tests passed in both **production-test** cache
modes, as did the native CommonJS export/import tests that had regressed before
v1.0.7. The original Log4brains CLI also ran with the **production-release**
loader on Node 20.20.2, preserving its version output. A complete CI suite
was not rerun as part of this verification.

Seven sequential, alternating-loader `--version` pairs used distinct compiler
caches for each cold/warm pair. Here are the medians from the **release** build
(in milliseconds):

| Loader                   | Cold CLI | Warm CLI |
| ------------------------ | -------: | -------: |
| Original `esm@3.2.25`    |  2,294.6 |  1,650.6 |
| Fork, production release |  2,932.0 |  1,704.8 |

The release fork was about **3% slower** on the warm CLI median. Cold CLI
results vary sharply with execution order (original 1,520–4,567 ms, fork
1,570–3,732 ms), so the cold medians do not establish a reproducible
performance ratio. An earlier **production-test** build comparison yielded
1,838.5/1,512.8 ms (original cold/warm) versus 2,879.7/1,619.5 ms (fork
cold/warm), which is a different loader build and measurement session.

The actual application supports `preview --no-open --port <port>`. Three pairs
per loader and cache state measured time from spawning the CLI to receiving
**HTTP 200 from `/`** on the local preview server. All twelve checks per build
variant succeeded. The medians (milliseconds) were:

| Build              | Loader                | Cold readiness | Warm readiness |
| ------------------ | --------------------- | -------------: | -------------: |
| Production release | Original `esm@3.2.25` |          7,894 |          7,494 |
| Production release | Fork                  |          5,476 |          5,277 |
| Production-test    | Original `esm@3.2.25` |          5,610 |          6,246 |
| Production-test    | Fork                  |          6,640 |          6,602 |

The fork was **faster** in the three-pair release-readiness comparison, but
**slower** in the three-pair production-test comparison. Even the unchanged
original loader's readiness medians shifted markedly between sessions. These
small, non-isolated samples include Next.js/runtime effects; they cannot
establish a stable improvement or regression for server readiness. Both
application behaviour and bundle compatibility are verified, not the original
startup-performance complaint.

The separate report of a private server slowing from roughly 10 to 30 seconds
cannot be reproduced without that application's dependency graph. **Keep
#844 under investigation** until there is a repeatable, controlled performance
baseline and profiling of any persistent warm-startup overhead, or the scope
and performance acceptance criteria are explicitly narrowed and documented.

### CommonJS interop uncovered by Log4brains

Log4brains' dependency graph includes `tslib@2.2.0`. Its `tslib.js` is a
CommonJS/UMD module that declares a nonenumerable `__esModule` property but
has no explicit `default` export. Its `modules/index.js` uses a default import
from that module. The fork previously treated the CommonJS marker as sufficient
to suppress a synthetic default, causing the real CLI to fail. Pseudo-ESM
CommonJS modules now receive a default binding of `module.exports` **only if**
they have no explicit default **and** export at least one name other than
`__esModule`. Marker-only modules keep empty namespaces. The regression covers
direct preloading and factory loading, cold and warm caches, marker-only
namespaces, and preservation of explicitly provided default exports.

## Jest transformer (#875, #706)

The package entry implements Jest's synchronous `process` and `getCacheKey`
interfaces. A CommonJS Jest configuration can transform ESM test files directly:

```js
module.exports = {
  testEnvironment: "node",
  transform: { "\\.m?js$": "esm-sync" }
}
```

No loader preload or per-test factory call is needed in this configuration.
Jest retains ownership of the host module; esm-sync compiles the supplied test
source into a separate loader record. Configured globals and Jest's per-file
`jest` object remain available. Direct and transitive imports share live
bindings, and dynamic imports use the loader.

Transformer cache keys include source, filename, configuration, instrumentation
options, Node version, and the installed bootstrap/loader code. The tests run
with caching disabled, then cold and warm Jest caches, and confirm that an
edited dependency is observed. The entry does not transform itself recursively
when Jest loads it from a checkout outside `node_modules`.

The transformer returns `{ code }`, which works with Jest 26 and matches the
modern synchronous return contract. If `supportsStaticESM` is true, it returns
the source unchanged for Jest's native ESM runtime. Contract tests exercise that
branch and both cache-key call signatures. **Jest 29/30 and their native ESM
runtimes have not been executed with the supplied dependencies.** This is not a
claim of full compatibility with every Jest feature, mock mode, or coverage
provider. See [Jest's transformer API](https://jestjs.io/docs/code-transformation).

## Protobuf filesystem discovery in Jest (#779)

A direct `node:fs` import did not reproduce this bug. The relevant historical
`@protobufjs/inquire` operation is a direct `eval` of a computed `require` name.
A copied intrinsic `eval` from another realm behaves as indirect evaluation,
losing the module's lexical `require` and making the optional filesystem probe
return `null`.

Context preparation now obtains the executing realm's intrinsic `eval`, while
preserving an application's custom eval function. The runtime compares against
that realm's eval when deciding whether to compile direct eval source.

The regression executes the historical probe inside Jest, verifies lexical
variables and an import inside eval, and feeds the discovered filesystem into
actual protobufjs `loadSync`. It loads a real `.proto` file, resolves its message
type, and encodes/decodes a message. Reset/isolation and a custom eval override
are also exercised. The original gRPC application and its old protobufjs release
were not supplied; this covers the reported eval/filesystem failure mechanism.

## Babel aliases and top-level await (#810)

The supplied original reproduction contains an await-only `src/database.js`:
its two-second sleep has no import/export statement. Previously, that file could
be classified as CommonJS and loading could return before the delay completed.
Unambiguous `.js` input with real top-level await and no CommonJS exports now uses module evaluation,
including side-effect-only dependencies and top-level for-await loops. The
runtime regression retains the original two-second delay and checks event
ordering, repeated loads, and rejection identity without timing thresholds.
Legacy await scripts with unshadowed `exports` or `module` retain their script
goal and CommonJS bindings, including when `cjs.vars` is disabled for ESM. Their
await metadata survives warm caches even when no source rewrite is needed.

Babel can produce either CommonJS or preserved ESM. The extension hook now
selects the compiler cache from the **transformed source content**, including
package options and filename, before reusing classification or bytecode. A
previous CommonJS transform cannot poison a subsequent preserved-ESM run with
the same source-file timestamp. The compiler cache version is incremented to
invalidate earlier classifications. Already-lowered recursive compilation keeps
its source identity. Missing transformed cache files trigger recompilation,
even when their classification and bytecode remain in the metadata index.

Preloads and later loader factories can also share module records across
bundle evaluations. Their await marker now uses a versioned symbol-registry key,
so the evaluating factory recognizes valid await tokens created by the loading
factory. Import finalization passes its loader through the inherited require,
avoiding duplicate records across factory caches while preserving require
interception, mock selection, and instrumentation hooks.

Installed `@babel/register` / `@babel/preset-env` regressions exercise both
CommonJS output and `modules: false`, both preload orders, direct entry launches
and later factories, cold/warm runs, and configuration changes in both
directions. They check evaluation order and a single execution. Keeping
`modules: false` preserves
ESM linking semantics; it is no longer the sole tested module-output setting.
The earlier alias-rewrite fixture remains covered.

The subsequent original-reproduction archive includes the exact
`babel-plugin-module-resolver@3.2.0` dependency tree. On Node 20.20.2, the
original `esm@3.2.25` Express application resolves `@routes/hello-world.route`
and responds `Hello world`, **but can start listening before the awaited
`src/database.js` finishes its two-second initialization**. An instrumented
probe detects this early return instead of mistaking a successful HTTP response
for correct top-level-await sequencing.

The earlier integration probe with an offline Acorn adapter reported that
the fork waited for database initialization with both Babel preload orders.
With the canonical Acorn production-test build, the separate installed-Babel
regression still passes both production cache variants. However, a direct run
of the instrumented original Express reproduction, using its original
`.babelrc` and `@babel/register` preload, fails with `SyntaxError: await is only
valid in async functions and the top level bodies of modules`: the Babel hook
sends the await-only `database.js` through Node's CommonJS compiler. This
uncovered difference must be investigated before declaring the exact original
configuration resolved. Node 20 also cannot use the fork's Node 24 native
await bridge; cross-version synchronous-await support is not established.

The separate `module-alias` fixture confirms that a CommonJS alias can coexist
with an unrelated ESM graph. CommonJS-only aliases and Node `#imports` through
the fork are not established as strict ESM aliases by these fixtures.

## `mainFields` and TypeScript hooks (#794)

A package with both `module: "./src/index.ts"` and `main: "./dist/index.js"`
selects its TypeScript source with `mainFields: ["module", "main"]`. A second
package with only `main` verifies fallback. Both ts-node and Babel extension
hooks transform the typed source in real subprocesses.

For ts-node, `TS_NODE_SKIP_IGNORE=true` allows `.ts` under `node_modules` to be
transformed. The fixture uses `ESNext`/`Bundler`, `TS_NODE_TRANSPILE_ONLY`, and
`TS_NODE_SKIP_PROJECT` to remain independent of the repository configuration.
The Babel fixture strips the simple type annotation using its configured Flow
plugin; this does not imply support for arbitrary TypeScript syntax.
