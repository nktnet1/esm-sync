# Synchronous async-module loading

The existing API returns fully evaluated exports for modules containing top-level
await expressions, including their static dependencies:

```js
const load = require("esm-sync")(module)
const namespace = load("./module-with-await.mjs")
```

No `await` option, Promise-returning loader API, worker, or runtime helper process
is required. Exported async functions keep returning ordinary Promises. `.mjs`
files and ESM `.js` files use the same generator-based evaluator; the historical
`await` option remains relevant to asynchronous CommonJS wrappers.

## Evaluation and caching

The compiler separates module instantiation from body execution. After linking,
the loader traces direct/transitive awaits and strongly connected components.
It starts independent dependencies in depth-first order before waiting, shares
records for dependencies reached by concurrent dynamic imports, and resumes
importers only when their required async dependencies have finished. Async parent
ordering is shared across concurrent graphs. Importers of a cycle wait for its
root, including when the imported cycle member has no await itself.

Successful loads preserve namespace identity, live bindings, CommonJS interop,
and single evaluation. Rejected modules retain the original thrown value, even
`undefined`, `null`, or another primitive. Subsequent imports of failed modules
and their affected importers rethrow that value. A failed cycle retains its
failure across its members.

Awaited dynamic imports join the evaluator without recursively polling the event
loop. Unawaited dynamic imports keep running asynchronously after the requested
root has completed. An import rejection caught by module code does not reject
that module's entire graph.

Async classification and evaluation state are rebuilt after reading compiled
code from disk. The compiler cache has a separate revision so older await
transforms cannot be reused after this change. Plain synchronous modules retain
their existing evaluator and do not load the native bridge.

## Timers and I/O

Microtasks and next ticks use Node's existing callback drain. Timers,
`node:fs/promises`, HTTP, and `fetch` can progress through an optional native
bridge that polls the current libuv loop with `UV_RUN_NOWAIT`.

The bridge permits polling only on the initial CommonJS startup stack. It checks
Node's execution async ID, V8's microtask state, and its own polling depth.
It refuses recursive polling from timers, I/O callbacks, next ticks, and Promise
reactions. This follows libuv's [non-reentrancy requirement](https://docs.libuv.org/en/v1.x/loop.html#c.uv_run).
Microtask-only loads can still complete from ordinary callbacks when Node can
drain their reactions. V8 cannot recursively drain an already running microtask.

The install script attempts to compile the bridge using matching Node headers
and a C++20 compiler. Builds used for testing require compilation to succeed.
The binary filename includes platform, architecture, and Node's module ABI;
binaries are not assumed compatible across Node majors. `ESM_SYNC_NODE_HEADERS`
can select headers, `ESM_SYNC_NODE_LIB` selects the directory containing Windows
`node.lib`, and `CXX` selects the compiler. Windows uses MSVC; macOS and Linux
use the platform C++ compiler. CI prepares Windows headers before building.

Consumers without a compiler/headers, or with lifecycle scripts disabled, retain
the pure-JavaScript loader and microtask-settled awaits. A timer/I/O await then
fails explicitly instead of pretending evaluation finished. `pnpm build:await`
builds the bridge explicitly. Native source and the build script are included
in the published package. The historical Node engine range is unchanged; the
optional bridge targets Node 22 and newer.

## Pending work and failure boundaries

`ESM_SYNC_AWAIT_TIMEOUT_MS` sets the polling deadline in milliseconds. It must be
a positive safe integer; the default is **5000 ms**. The deadline uses a monotonic
clock. The evaluator never uses blocking `UV_RUN_ONCE`, and sleeps for at most
one millisecond between nonblocking polls.

| Error code | Meaning |
| --- | --- |
| `ERR_ESM_SYNC_ASYNC_PENDING` | No active event-loop work can resolve an outstanding await, or the required native bridge is unavailable. |
| `ERR_ESM_SYNC_ASYNC_REENTRANT` | The caller would need unsafe recursive loop/microtask execution, or would observe an unfinished async module through synchronous re-entry. |
| `ERR_ESM_SYNC_ASYNC_TIMEOUT` | The polling deadline expired, or its environment setting is invalid. |

A loader failure is not thrown into the module's generator as a rejected await:
module code cannot catch it and manufacture a successful partial namespace. The
evaluator abandons affected generators without calling `return()`, which would
execute user `finally` blocks. Outstanding Promise rejections remain observed,
and later settlement cannot resume an abandoned module body.

This does not cancel external operations already started by module code, such as
an HTTP request or an independently running async function. It cannot preempt an
infinite JavaScript callback or endlessly draining microtask chain. Unrelated
active handles can keep an unresolved Promise eligible for polling until the
deadline. Top-level `for await...of` and `await using` currently produce explicit
compilation errors.

## Validation

`test/vitest/top-level-await.test.mts` exercises completed exports, async exports,
live bindings, repeated loads, nested awaits, statement boundaries, default
exports, binding-pattern awaits, sibling/diamond graphs, cycles and TDZ errors,
timers, filesystem reads, loopback fetch, dynamic imports, primitive rejections,
abandonment, deadlines, unsafe re-entry, missing bridges, and fresh processes
with disabled and populated disk caches.

`test/vitest/test262-async-evaluation.test.mts` keeps ten pinned Test262 async
graph cases in the required suite, in cached and uncached modes. They cover
independent siblings, thenables, DFS ordering, cycle roots, dynamic imports,
leaf-to-root fulfillment/rejection, and concurrent async evaluation ordering.
The Test262 phase checker validates native await syntax before execution-time
yield lowering; module tests start the synchronous loader outside a Promise
reaction. No corpus exclusions or assertions are relaxed.

## Recorded validation

Linux x64 runs used the supplied Node **22.23.4**, **24.21.0**, and **26.12.0**
executables. Each runtime passed **54 async checks in development and 54 in
production**, including cached and uncached cases: **324 checks** in total.
The packed CommonJS consumer and CLI preload passed on all three runtimes with
native timer awaits, namespace identity, and live bindings. Package contents
were checked without installing dependencies.

The complete Node 24 production run passed **861 tests**, with **102 existing
skips**. Its two PM2 suite hooks failed because this environment rejected Unix
socket connections with `EPERM`; the async suites passed. Biome and both
TypeScript projects passed. Native bridge builds succeeded for all three supplied
Node ABIs. Windows/macOS execution remains covered by the configured CI matrix,
not by these Linux-only local runs.

The unchanged pinned `module-code/top-level-await` group passes **238/250** cases.
All **12** remaining failures are top-level `for await...of` cases. There are no
new exclusions. In particular, both fulfillment/rejection ordering cases and
the concurrent async-evaluation ordering case pass.

## Benchmark procedure

`pnpm benchmark:await --baseline /path/to/baseline --samples 7 --iterations 5000`
compares the current checkout with an already-built baseline using the same Node
executable. Both checkouts must use the same development/production build mode.
`--json` emits machine-readable output.

Each sample uses a fresh process, disables disk compilation caching, and times
the first module load after loader initialization. Warm measurements repeatedly
load the same module and verify namespace identity. Results report medians for a
plain synchronous module, two-module synchronous graph, 18-module synchronous
chain, microtask await, transitive await, and one-millisecond timer. Process startup
and loader bootstrap are excluded. A baseline without timer support is recorded
as unsupported.

## Recorded benchmark

Node 24.21.0 on Linux x64, seven fresh-process pairs per case, with 5,000 warm
requires per process. Pair order alternates to limit ordering bias. Baseline is
the supplied bundle at `5d5a22a3`, built in the same mode. These local medians
remain sensitive to host scheduling.

| Mode | Case | Baseline cold (ms) | Current cold (ms) | Baseline warm (µs) | Current warm (µs) |
| --- | --- | ---: | ---: | ---: | ---: |
| Development | sync | 15.211 | 14.873 | 7.502 | 7.383 |
| Development | sync-graph | 18.803 | 19.990 | 7.794 | 8.013 |
| Development | sync-chain | 36.412 | 35.952 | 7.578 | 7.614 |
| Development | microtask | 15.608 | 16.892 | 7.128 | 7.320 |
| Development | transitive | 19.611 | 20.740 | 7.450 | 7.091 |
| Development | timer | unsupported | 20.323 | unsupported | 7.357 |
| Production | sync | 13.734 | 13.576 | 7.526 | 6.564 |
| Production | sync-graph | 18.134 | 16.618 | 7.194 | 7.386 |
| Production | sync-chain | 32.151 | 32.626 | 6.571 | 7.049 |
| Production | microtask | 14.868 | 14.828 | 7.475 | 6.969 |
| Production | transitive | 18.300 | 17.992 | 7.231 | 7.112 |
| Production | timer | unsupported | 18.397 | unsupported | 6.795 |
