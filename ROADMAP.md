# Roadmap

## Primary goal: synchronous loading of top-level `await` modules

Support ESM modules with top-level `await` (TLA), including transitive dependencies,
**without changing how consumers use `esm-sync`**:

```js
const esmRequire = require("esm-sync")(module)
const loaded = esmRequire("./module-with-top-level-await.mjs") // No await or .then()
```

Successful loads must return fully evaluated exports synchronously, not a Promise
or a partially initialised namespace. Preserve existing CommonJS interoperability,
live bindings, cycles, module identity, caching, and performance for modules without
TLA. Exported `async` functions still return Promises; only **module loading** is
in scope.

Arbitrary asynchronous work cannot always be completed synchronously on the same
JavaScript thread. Prioritise transparent support where feasible, and provide a
clear error rather than hanging or returning incomplete exports otherwise.

### Implemented async handling

- [x] Trace TLA through parsing, linking, and evaluation (`src/entry.js` and
      `src/module/internal/compile.js`); classify direct/transitive async graphs
      and cycles before execution.
- [x] Extend microtask-settled TLA support to timers, filesystem, and network
      I/O where safe; validate re-entrancy, runtime portability, and overhead
      without workers or consumer API changes.
- [x] Implement graph-aware evaluation, dependency ordering, rejection handling,
      and caching without breaking the existing synchronous loader.
- [x] Handle unsatisfiable or never-settling async dependencies without deadlocks,
      false success, or partially evaluated exports.
- [x] Test fulfilled/rejected TLA, transitive imports, cycles, microtasks, timers,
      filesystem/network I/O, repeated loads, live bindings, and async exports.
- [x] Validate with targeted Test262 cases and real Node 22/24/26 processes across
      development/production and cached/uncached modes; benchmark cold and warm
      loads against the current synchronous path.

See [async module loading](docs/async-module-loading.md) for the supported execution
contexts, optional native bridge, deadline, validation, and benchmark procedure.

### Async follow-up

- [x] Lower top-level `for await...of`, including async-from-sync iteration,
      lexical bindings, labels, abrupt exits, and awaited iterator cleanup.
- [x] Lower module-body `await using` and related `using` scopes, including
      switch/classic-for and per-iteration resources, reverse disposal order,
      synchronous fallbacks, suppressed errors, and live module exports.
- [x] Prevent public synchronous loads from exposing pending async graphs or
      completed members of a pending cycle; restore parsing state and balance
      require depth after nested and failed loads.
- [x] Exercise ordinary asynchronous imports with iteration, timers, and disposal
      from callbacks, Promise reactions, microtasks, and workers. Keep the
      synchronous loader's existing API and failure boundaries.
- [x] Keep all four PM2 scenarios enabled with isolated daemon homes and bounded
      teardown, private Windows pipes, and real loopback TCP endpoints when Unix
      sockets are prohibited.
- [x] Fix the CI cache-removal race: test default cache paths in private package
      copies, including bootstrap caching that ignores module `options.cache`.
      Run those assertions alongside unrelated bootstrap-cache writers.
- [x] Make the missing-native-bridge regression recognize Windows paths through
      generated subprocess source, and assert that the bridge was intercepted.
- [x] Define and enforce the limit on synchronous I/O beyond the initial
      CommonJS startup stack. **Unsupported with current Node/libuv APIs:**
      [libuv forbids recursive `uv_run()` calls from callbacks](https://docs.libuv.org/en/v1.x/loop.html#c.uv_run),
      and V8 cannot recursively drain an already-running microtask queue.
      Callback/microtask/worker and nested-load regressions require
      `ERR_ESM_SYNC_ASYNC_REENTRANT`; the native poll guard uses the same code.
      Missing bridges preserve their load error as `cause` on
      `ERR_ESM_SYNC_ASYNC_PENDING`. This resolves the support decision without
      claiming that callback I/O can be completed synchronously.
- [x] Include both pinned explicit-resource-management groups in fixture
      preparation and require all ten module-goal cases in cached and uncached
      Node 22/24/26 tests. Reject older prepared subsets missing these groups.
- [x] Evaluate async dependencies of static/dynamic deferred imports in request
      order, wait for pending cycle roots, and defer only synchronous bodies.
      Reject premature namespace access with a coded `TypeError`.
- [x] Preserve intrinsic Promise behavior and import completion order; record
      cycle failures before teardown and retain their original error identity.
      Run script-goal imports through esm-sync while retaining script semantics.

## Other outstanding work

- [x] Resolve the remaining Test262 failures without broadening exclusions.
      The expanded pinned selection has no failures or exclusions; nine cases
      retain explicit host/ModuleSource unsupported classifications.
- [ ] Verify Node 22/24/26 CI on Linux, macOS, and Windows, including production
      builds, Node internals, and packed-package integration tests.
- [ ] Complete pnpm 12 reproducible installs and frozen-lockfile CI; review
      dependency updates and outstanding audit findings.
- [ ] Replace Rspack/Babel with tsdown/Oxc only after verifying equivalent loader
      output, custom transformations, module semantics, and package contents.
