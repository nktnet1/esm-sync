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
Rejection propagation finishes before graph cleanup, so a later import of a
previously completed cycle member rejects with that same error object.

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

## Deferred imports

Static `import defer` and dynamic `import.defer()` gather asynchronous
dependencies in request order. A target containing TLA executes eagerly;
otherwise its asynchronous dependencies finish first and its synchronous body
stays deferred until an export operation. Shared dependencies execute once,
and an in-flight async cycle is complete only when its root finishes.
Dependencies are deduplicated by module identity, preserving separate text and
JavaScript records for the same file.

Reading a deferred namespace while its module or dependencies are evaluating
throws a `TypeError` with `code: "ERR_ESM_SYNC_ASYNC_REENTRANT"`. The namespace
can be read after evaluation finishes. Evaluation failures retain their
original values and identities.

Successful dynamic imports resolve when their evaluation completes, without an
extra event-loop turn that could let a later failed import reject first. Await,
async iteration, disposal, and deferred-import aggregation use captured Promise
intrinsics rather than user-replaced `Promise.prototype.then`, `Promise.resolve`,
or `Promise.reject` methods.

## Async iteration and resource management

Module-body `for await...of` supports synchronous and asynchronous iterables,
destructuring defaults containing awaits, fresh lexical iteration bindings, and
labeled break/continue. It captures `next` once, unwraps promise values only for
synchronous iterators, and waits for iterator cleanup on an abrupt exit. Errors
in the body retain precedence over errors from iterator cleanup. Errors in
`next`, `done`, or `value` do not spuriously close the iterator.

Module-body `await using` and related synchronous `using` declarations preserve
module, block, switch, and loop scopes and dispose resources in reverse
registration order. Async disposal finishes before the loader returns the
module's exports. Export getters
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
Those function/static-block declarations require native syntax support;
unsupported host syntax produces a `SyntaxError` before execution.

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
module identity. This is a documented unsupported capability under the current
runtime APIs, with regression-tested errors in JavaScript and the native poll
entry point. That support decision is resolved; synchronous callback I/O remains unsupported.

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
clock, starting when native polling is first required. The evaluator never uses
blocking `UV_RUN_ONCE`, and requests a one-millisecond sleep between nonblocking
polls. OS scheduling and callbacks can exceed that interval. It checks the deadline before and
after polling, and before a Promise reaction resumes a synchronously waiting
module. Slow callbacks or OS descheduling therefore cannot turn an expired wait
into a successful load. Ordinary detached asynchronous imports keep their normal
completion semantics. Timeout regressions use an explicitly settled pending
operation, rather than racing two short timers.

| Error code | Meaning |
| --- | --- |
| `ERR_ESM_SYNC_ASYNC_PENDING` | No active event-loop work can resolve an outstanding await, or the required native bridge is unavailable. |
| `ERR_ESM_SYNC_ASYNC_REENTRANT` | The caller would need unsafe recursive loop/microtask execution, or would observe an unfinished async module through synchronous re-entry. |
| `ERR_ESM_SYNC_ASYNC_TIMEOUT` | The polling deadline expired, or its environment setting is invalid. |

An unavailable bridge includes the original module-load failure as its
non-enumerable `cause`, preserving missing-binary and ABI/load diagnostics.
Deferred namespace access uses `TypeError` plus the re-entry code; the ordinary
synchronous loader and direct native poll guard use `Error` with that code.

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

`test/vitest/top-level-await.test.ts` exercises completed exports, async exports,
live bindings, repeated loads, nested awaits, statement boundaries, default
exports, binding-pattern awaits, sibling/diamond graphs, cycles and TDZ errors,
timers, filesystem reads, loopback fetch, dynamic imports, primitive rejections,
abandonment, deadlines, unsafe re-entry, missing bridges, and fresh processes
with disabled and populated disk caches.

The missing-bridge case uses path operations and checks an actual blocked native
load. It also exercises Windows-style paths through its generated subprocess
source, preventing the template-string/regular-expression escaping bug reported
by Windows CI.

`test/vitest/async-syntax.test.ts` covers iterator protocols, abrupt cleanup,
destructuring, lexical heads and labels, import assignment errors, exported live
bindings, module/block/iteration disposal, primitive and suppressed errors,
disposal fallbacks, and class name inference. Cached cases run again in a fresh
process against the populated disk cache.

`test/vitest/async-contexts.test.ts` checks callbacks, next ticks, Promise
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

`test/vitest/test262-async-evaluation.test.ts` keeps ten pinned Test262 async
graph cases and all twelve previously failing for-await syntax cases in the
required suite, in cached and uncached modes. They cover
independent siblings, thenables, DFS ordering, cycle roots, dynamic imports,
leaf-to-root fulfillment/rejection, and concurrent async evaluation ordering.
The Test262 phase checker validates native await syntax before execution-time
yield lowering; module tests start the synchronous loader outside a Promise
reaction. No corpus exclusions or assertions are relaxed.

`test/vitest/test262-async-followup.test.ts` makes the twelve reported failures,
three dynamic-import/for-await cases, waiting-module import order, script text
imports, and all ten module-goal resource-management cases required regressions.
Each cached case runs twice in fresh processes. Fixture preparation includes
both `statements/using` and `statements/await-using` at the existing pinned SHA
and rejects an older prepared subset missing either directory.

Script-goal cases keep `vm.Script` global scope and grammar while their import
calls use esm-sync's runtime. This tests the loader and avoids Node/V8's fatal
errored-cycle evaluation path. Returned import Promises retain their identity;
unrelated unhandled rejections remain failures. The wrapper also uses captured
Promise methods so its own completion observation cannot affect assertions
about patched `Promise.prototype.then`.

The phase checker validates resource grammar with strict Acorn, then uses
`const` declarations only in its non-executed validation text for Node's other
early-error checks. Node 22 can therefore validate declarations that the loader
supports even though the host parser cannot parse that syntax natively.

## Recorded validation

Linux x64 runs used the supplied Node **22.23.4**, **24.21.0**, and **26.12.0**
executables. The final source passed **96 targeted development checks on each
runtime**, covering 21 async-syntax scenarios and 27 pinned upstream cases in
cached and uncached modes. Cached cases run twice in fresh processes.

The complete production suites on Node 24 and 26 each passed **1,122 tests in
25 files**, with no failures or skips. Node 22 passed **277 focused production
checks in nine files**, including all async, phase-validation, fixture, and
selection regressions. All four PM2 scenarios passed in both cache modes with
real daemons and IPC. The cache concurrency and missing-bridge regressions
passed. Native bridge builds succeeded for all three supplied Node ABIs.
The packed CommonJS consumer and CLI preload passed on all three runtimes,
including native awaits, iteration/disposal, deferred dependencies, namespace
identity, and live bindings. Package contents were checked without installing
dependencies. Biome and both TypeScript projects passed.
Windows/macOS execution remains covered by the configured CI matrix, not by
these Linux-only local runs; the reported Node 26.12.1 runtime was not supplied.

The complete pinned Test262 selection on the final Node 24 production build
reports **1,755 selected: 1,746 passed, 0 failed, 9 unsupported, 0 excluded**.
All twelve reported failures pass without weakening their
assertions, expected errors, or phases. The selection retains every original
case and adds all ten upstream module-goal resource-management cases at the
same pinned revision. All **250/250** top-level-await cases pass.

The nine unsupported cases are explicit capabilities: five require immutable
ArrayBuffers, one requires private fields to respect non-extensibility, and
three require a JavaScript ModuleSource representation. The first six depend
on host behavior; unsupported source-phase runtime requests throw `SyntaxError`.
No async failure is hidden by an unsupported classification.

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
use production builds; the baseline is the v1.0.1 patch state (source tree
`cffa63e5c2815d49930e8866b4c3b1217f3c2564`). These local medians remain sensitive
to host scheduling. Warm differences vary by case, from a 1.50 µs improvement
to a 1.05 µs increase; this run does not establish a general speed improvement.

| Case | Baseline cold (ms) | Current cold (ms) | Baseline warm (µs) | Current warm (µs) |
| --- | ---: | ---: | ---: | ---: |
| sync | 16.151 | 15.966 | 7.651 | 8.207 |
| sync-graph | 18.056 | 18.557 | 7.082 | 8.132 |
| sync-chain | 38.814 | 38.391 | 9.116 | 7.619 |
| microtask | 17.010 | 18.558 | 7.898 | 8.546 |
| transitive | 21.243 | 21.324 | 7.335 | 7.371 |
| timer | 24.178 | 22.460 | 8.716 | 7.696 |
