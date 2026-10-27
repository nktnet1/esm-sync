# Synchronous async-module loading

`esm-sync` can return fully evaluated ESM exports even when a module or its
static dependencies contain top-level `await`, `for await...of`, or `await using`:

```js
const load = require("esm-sync")(module)
const namespace = load("./module-with-await.mjs")
```

The API remains synchronous; exported async functions still return Promises.

## Evaluation and module identity

The loader links modules before evaluating them, waits for transitive async
dependencies, and handles async cycles and concurrent dynamic imports. Completed
loads preserve namespace identity, live bindings, and single evaluation.
Rejections preserve the original thrown value (including primitives) for
subsequent imports of failed modules and affected cycles. Disk compilation
cache entries reconstruct evaluation state rather than persisting it.

Static `import defer` and dynamic `import.defer()` postpone synchronous module
bodies until namespace access while respecting asynchronous dependencies.
Accessing a namespace before evaluation finishes raises
`ERR_ESM_SYNC_ASYNC_REENTRANT` instead of returning partial exports.

Module-body asynchronous iteration closes iterators on abrupt exits. `using`
and `await using` dispose resources in reverse acquisition order before
synchronous loading returns. The lowering applies to module execution, not to
exported async functions or class static blocks; those still rely on native
syntax support in the host runtime.

## Native bridge and re-entry limits

Microtask-settled awaits can finish through Node's existing callback drain.
Timers and I/O require an optional native bridge that polls the current libuv
loop. It is usable on the initial CommonJS startup stack, **not** recursively
from an active callback or Promise reaction. Recursive polling would be unsafe
under libuv's non-reentrancy rules.

| Calling context                      | Microtask-settled await                                | Timer/I/O-settled await      |
| ------------------------------------ | ------------------------------------------------------ | ---------------------------- |
| Initial CommonJS startup             | Supported                                              | Supported with native bridge |
| Timer, next tick, or I/O callback    | Supported when no active async graph requires re-entry | Re-entry error               |
| Promise reaction or queued microtask | Re-entry error if another checkpoint is needed         | Re-entry error               |

Ordinary asynchronous `import()` remains available in all these contexts.
Unawaited imports can continue after a synchronous root load completes. Worker
threads may use ordinary async imports, but synchronous worker I/O awaits remain
guarded.

The installer attempts to compile the bridge from `native/sync-await.cc` using
matching Node headers and a C++20 compiler. `ESM_SYNC_NODE_HEADERS`,
`ESM_SYNC_NODE_LIB` (Windows), and `CXX` customise its toolchain. The binary is
specific to the platform, architecture, and Node ABI. Without it, pure-JavaScript
loading and microtask awaits still work; synchronous timer/I/O awaits fail
explicitly. `pnpm build:await` rebuilds the bridge.

### pnpm installations without build permission

pnpm can skip the install hook. A matching bundled bridge remains usable without
running a compiler. When no compatible bridge is present, ordinary CJS/ESM loads
and microtask-settled top-level awaits still work. A synchronous await that needs
timers or I/O fails with `ERR_ESM_SYNC_ASYNC_PENDING`; the loader does not compile
or download a bridge at runtime.

On pnpm 12, an unreviewed dependency build can fail installation under the
default `strictDepBuilds` policy. To explicitly decline this package's build,
record the decision in `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esm-sync: false
```

If the workspace already uses `permissions`, its `esm-sync.build` decision takes
precedence over `allowBuilds`. Allow the hook when a local bridge build is needed.
The installer reuses a valid bundled bridge before looking for a compiler.
Explicit source builds continue to rebuild the bridge.

See pnpm's [build settings](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/settings/build.md)
for `allowBuilds`, `permissions`, and `strictDepBuilds`.

## Errors and timeouts

`ESM_SYNC_AWAIT_TIMEOUT_MS` sets a positive, safe-integer polling deadline in
milliseconds (default: `5000`). The native bridge uses nonblocking polling;
slow callbacks or OS scheduling can still exceed its nominal interval.

| Error code                     | Meaning                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `ERR_ESM_SYNC_ASYNC_PENDING`   | Await cannot make progress, or the native bridge is unavailable                  |
| `ERR_ESM_SYNC_ASYNC_REENTRANT` | Synchronous access would require unsafe re-entry or observe an incomplete module |
| `ERR_ESM_SYNC_ASYNC_TIMEOUT`   | Deadline expired or setting is invalid                                           |

A failed synchronous load abandons affected generators without executing user
`finally` blocks or exposing partially evaluated exports. It does **not** cancel
external I/O already started, nor can it preempt an infinite JavaScript callback.

## Regression tests

`test/vitest/top-level-await.test.ts`, `async-syntax.test.ts`, and
`async-contexts.test.ts` cover evaluation, caching, disposal, failure identity,
context restrictions, workers, and the bridge. Pinned Test262 async regressions
cover module ordering and error phases. To compare startup and cached-load costs
against a previously built checkout, use:

```sh
pnpm benchmark:await --baseline /path/to/baseline --samples 7 --iterations 5000
```
