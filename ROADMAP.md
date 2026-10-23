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

- [ ] Lower top-level `for await...of` loops and `await using`. These currently
      fail explicitly during compilation; ordinary top-level await expressions
      already work without the legacy `await` option.
- [ ] Extend synchronous I/O support beyond the initial CommonJS startup stack
      only if Node/libuv provide a safe re-entrant execution mechanism. Pending
      awaits in unsafe callbacks or microtasks currently fail explicitly.

## Other outstanding work

- [ ] Triage remaining Test262 failures (including dynamic imports, syntax errors,
      and ambiguous exports) without broadening exclusions; rerun the pinned corpus.
- [ ] Verify Node 22/24/26 CI on Linux, macOS, and Windows, including production
      builds, Node internals, and packed-package integration tests.
- [ ] Complete pnpm 12 reproducible installs and frozen-lockfile CI; review
      dependency updates and outstanding audit findings.
- [ ] Replace Rspack/Babel with tsdown/Oxc only after verifying equivalent loader
      output, custom transformations, module semantics, and package contents.
