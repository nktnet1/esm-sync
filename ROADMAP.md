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

### Remaining work

- [ ] Trace TLA through parsing, linking, and evaluation (`src/entry.js` and
      `src/module/internal/compile.js`); classify direct/transitive async graphs
      and cycles before execution.
- [ ] Investigate sync-compatible transformations and native event-loop/microtask
      progress. Evaluate correctness, re-entrancy, overhead, and failure cases;
      do not require workers or a new consumer API by default.
- [ ] Implement graph-aware evaluation, dependency ordering, rejection handling,
      and caching without breaking the existing synchronous loader.
- [ ] Handle unsatisfiable or never-settling async dependencies without deadlocks,
      false success, or partially evaluated exports.
- [ ] Test fulfilled/rejected TLA, transitive imports, cycles, microtasks, timers,
      filesystem/network I/O, repeated loads, live bindings, and async exports.
- [ ] Validate with targeted Test262 cases and real Node 22/24/26 processes across
      development/production and cached/uncached modes; benchmark cold and warm
      loads against the current synchronous path.

## Other outstanding work

- [ ] Triage remaining Test262 failures (including dynamic imports, syntax errors,
      and ambiguous exports) without broadening exclusions; rerun the pinned corpus.
- [ ] Verify Node 22/24/26 CI on Linux, macOS, and Windows, including production
      builds, Node internals, and packed-package integration tests.
- [ ] Complete pnpm 12 reproducible installs and frozen-lockfile CI; review
      dependency updates and outstanding audit findings.
- [ ] Replace Rspack/Babel with tsdown/Oxc only after verifying equivalent loader
      output, custom transformations, module semantics, and package contents.
