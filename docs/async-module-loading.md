# Synchronous async-module loading

The existing API returns fully evaluated exports for modules containing top-level
await expressions, `for await...of`, and `await using`, including their static
dependencies:

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

Public synchronous loads cannot expose an evaluating module, including a cycle
member whose own body has finished while its async root is still pending. The
linking lookup used by `esmRequire` applies the same boundary. Nested and failed
loads restore the caller's parsing state and balance its require depth.

## Async iteration and resource management

Module-body `for await...of` supports synchronous and asynchronous iterables,
destructuring defaults containing awaits, fresh lexical iteration bindings, and
labeled break/continue. It captures `next` once, unwraps promise values only for
synchronous iterators, and waits for iterator cleanup on an abrupt exit. Errors
in the body retain precedence over errors from iterator cleanup. Errors in
`next`, `done`, or `value` do not spuriously close the iterator.

Module-body `await using` and related synchronous `using` declarations preserve
module, block, switch, and loop scopes and dispose resources in reverse
registration order. Async disposal finishes before the loader returns the module's exports. Export getters
and hoisted functions remain in the same lexical scope as their declarations,
including in cycles. Per-iteration resources finish disposal before the next
iteration or iterator close.

The async disposal protocol falls back to `Symbol.dispose` when appropriate;
the fallback ignores that synchronous method's return value. Null/undefined
async resources still cause the required suspension. Acquisition/disposal
failures preserve primitive thrown values and suppression order. Native
`SuppressedError` is used where available; older runtimes receive an Error named
`SuppressedError` with non-enumerable `error` and `suppressed` properties.
Node 22's disposal symbols are resolved through its `nodejs.dispose` and
`nodejs.asyncDispose` aliases when the loader's V8 realm lacks the global aliases.

Await/using syntax inside functions and class static blocks retains the host
runtime's behavior. The new lowering applies to module execution, including
its nested statements, rather than changing exported async functions.

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

| Calling context | Microtask-settled TLA | Timer/I/O-settled TLA | Ordinary asynchronous `import()` |
| --- | --- | --- | --- |
| Initial CommonJS startup | Supported | Supported with the native bridge | Supported |
| Timer, immediate, next tick, or I/O callback | Supported outside an active graph evaluation | Explicit re-entry error | Supported |
| Promise reaction or queued microtask | Explicit re-entry error when another checkpoint is needed | Explicit re-entry error | Supported |

Workers can use ordinary asynchronous imports, including modules with async
iteration and disposal. Synchronous worker I/O awaits remain guarded. Calls
made while another synchronous async-graph evaluation is active cannot start a
nested asynchronous graph or observe a pending namespace.

Extending synchronous I/O to callbacks is blocked on a supported Node/libuv
mechanism. Removing the guards would recursively enter an executing loop; moving
the work to a different loop/thread would change the execution context and
module identity. This patch keeps that roadmap item open and adds coverage of
each calling context instead of claiming that recursive polling is safe.

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
deadline. Abandoning a suspended disposer does not run any remaining disposers
or resume importing module bodies; independently running async methods can
still finish their own external work.

## Validation

`test/vitest/top-level-await.test.mts` exercises completed exports, async exports,
live bindings, repeated loads, nested awaits, statement boundaries, default
exports, binding-pattern awaits, sibling/diamond graphs, cycles and TDZ errors,
timers, filesystem reads, loopback fetch, dynamic imports, primitive rejections,
abandonment, deadlines, unsafe re-entry, missing bridges, and fresh processes
with disabled and populated disk caches.

The missing-bridge case uses path operations and checks an actual blocked native
load. It also exercises Windows-style paths through its generated subprocess
source, preventing the template-string/regular-expression escaping bug reported
by Windows CI.

`test/vitest/async-syntax.test.mts` covers iterator protocols, abrupt cleanup,
destructuring, lexical heads and labels, import assignment errors, exported live
bindings, module/block/iteration disposal, primitive and suppressed errors,
disposal fallbacks, and class name inference. Cached cases run again in a fresh
process against the populated disk cache.

`test/vitest/async-contexts.test.mts` checks callbacks, next ticks, Promise
reactions, microtasks, workers, nested synchronous loads, pending cycle members,
and abandoned disposers. It also verifies that ordinary asynchronous imports
complete iteration and disposal in those contexts.

PM2 tests create a private daemon home, use private named pipes on Windows, and
probe Unix-socket support elsewhere. On hosts that reject Unix sockets with
`EPERM`/`EACCES`, real PM2 RPC/PUB/interactor endpoints use reserved loopback TCP
ports. The endpoint preload applies those settings to PM2 7's Windows constants
as well as the daemon and applications. The hooks never start a daemon merely to
kill a stale one, and command/shutdown waits are bounded. All four integration
cases retain their readiness, version, log, and liveness assertions.
The fixture Node executable is copied rather than hard-linked to the selected
runtime; POSIX PM2 applications use its absolute path, and Windows uses the
fixture directory on `PATH` with PM2's required `node` interpreter name.

Cache tests run default-path consumers in private copies of the built package.
This matters because `esm.js` caches its bootstrap script at a fixed path even
when a caller disables or isolates module caching with `options.cache`. The
suite no longer moves/removes the repository's shared bootstrap cache while
other test processes can write it on exit. A regression runs the default-cache
suite concurrently with unrelated bootstrap writers; default-path, disabled-cache,
restart, and cache-content assertions remain enabled.

`test/vitest/test262-async-evaluation.test.mts` keeps ten pinned Test262 async
graph cases and all twelve previously failing for-await syntax cases in the
required suite, in cached and uncached modes. They cover
independent siblings, thenables, DFS ordering, cycle roots, dynamic imports,
leaf-to-root fulfillment/rejection, and concurrent async evaluation ordering.
The Test262 phase checker validates native await syntax before execution-time
yield lowering; module tests start the synchronous loader outside a Promise
reaction. No corpus exclusions or assertions are relaxed.

## Recorded validation

Linux x64 runs used the supplied Node **22.23.4**, **24.21.0**, and **26.12.0**
executables. Each runtime passed **148 async checks in development and 148 in
production**, including cached and uncached cases: **888 checks** in total.
The packed CommonJS consumer and CLI preload passed on all three runtimes with
native timer awaits, async iteration/disposal, namespace identity, and live
bindings. Package contents were checked without installing dependencies.

The complete Node 26 development and production runs and Node 24 production run
each passed **1,058 tests**, with **no failures or skips**. All four PM2 scenarios
passed in both cache modes with real daemons and IPC. The cache concurrency
regression and missing-bridge regression passed. Biome and both TypeScript
projects passed. Native bridge builds succeeded for all three supplied Node ABIs.
Windows/macOS execution remains covered by the configured CI matrix, not by
these Linux-only local runs; the reported Node 26.12.1 runtime was not supplied.

The unchanged pinned `module-code/top-level-await` group passes **250/250** cases,
including all twelve previously failing top-level `for await...of` cases, with
no exclusions or unsupported cases. All three related dynamic-import/for-await
cases also pass. Both fulfillment/rejection ordering cases and the concurrent
async-evaluation ordering case pass. The supplied corpus has
no explicit-resource-management group; adding those upstream cases remains a
roadmap item alongside the required disposal regression scenarios.

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
requires per process. Pair order alternates to limit ordering bias. Both loaders
use production builds; the baseline is the v1.0.0 patch state (source tree
`11a009924ad80d21448ef76ff6610307b007815b`). These local medians remain sensitive
to host scheduling. Warm differences vary by case, from a 0.53 µs improvement
to a 0.82 µs increase; this run does not establish a general speed improvement.

| Case | Baseline cold (ms) | Current cold (ms) | Baseline warm (µs) | Current warm (µs) |
| --- | ---: | ---: | ---: | ---: |
| sync | 14.799 | 14.695 | 7.754 | 7.821 |
| sync-graph | 20.449 | 19.755 | 7.706 | 8.528 |
| sync-chain | 39.993 | 41.816 | 8.559 | 8.365 |
| microtask | 18.284 | 17.410 | 7.327 | 7.962 |
| transitive | 21.170 | 23.636 | 7.699 | 8.400 |
| timer | 22.786 | 21.386 | 7.938 | 7.411 |
