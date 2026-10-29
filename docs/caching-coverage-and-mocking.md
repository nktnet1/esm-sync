# Caching, coverage, and mocking

## Persistent compilation and evaluated modules

These settings control different caches:

| Setting                  | Behaviour                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `cache: false`           | Disables persistent compiler output for the configured package.                                                     |
| `cache: "directory"`     | Selects the base directory for persistent compiler output.                                                          |
| `cjs.cache: true`        | Exposes eligible `.js` ES modules in the CommonJS module cache, allowing CommonJS tools to manage those entries.    |
| `ESM_DISABLE_CACHE=true` | Bypasses persistent compiler and bootstrap cache reads and writes from startup. Existing cache files are preserved. |

Set `ESM_DISABLE_CACHE` before loading esm-sync. It accepts JSON values: `true`
and `1` disable persistent caching; `false`, `0`, and invalid JSON do not. The
environment setting takes precedence over a configured compiler cache path.

Disabling persistent compilation does not invalidate evaluated modules. Repeated
loads in the same module graph keep the same exports, even if the source file
changes. This also applies to `{ cache: false, cjs: { cache: false }, force: true }`.
Use a fresh process or worker when a clean configuration/module graph is needed.
Deleting a compiler cache is not a hot-reload mechanism. CommonJS cache deletion
only affects exposed entries; existing importers can still retain their bindings.

## NYC

esm-sync preserves installed extension transforms rather than replacing the
`.js` handler at bootstrap. NYC instrumentation can therefore run before the
module is compiled, including for `.mjs` dependencies. Both legacy
`NYC_ROOT_ID` and current `NYC_PROCESS_ID`/`NYC_CONFIG` environments are recognized.
Loader-created modules retain the host `Module` prototype identity so native
compilation checks also work when Babel and NYC compose their hooks.

For example:

```sh
nyc --require esm-sync node test.mjs
nyc --require ts-node/register --require esm-sync mocha --extension ts "test/**/*.test.ts"
```

Load ts-node before esm-sync when TypeScript needs a require-extension transform.
The compatibility tests cover both CommonJS output and preserved ES module
syntax from ts-node. A configuration for the latter uses `module: "ESNext"`,
`moduleResolution: "Bundler"`, and `target: "ES2022"`; esm-sync handles the emitted
imports and exports. Ensure the project's normal ts-node configuration and
test-runner types are also present.

Instrumented compiler output is stored in a `nyc-<hash>` subdirectory of the
selected cache directory. The hash includes NYC's configuration, keeping it
separate from ordinary output and other coverage configurations. Changing
include/exclude settings must not reuse the previous instrumentation. This
separation also applies when an explicit `cache` directory is supplied.

`ESM_DISABLE_CACHE=true` bypasses these directories too. NYC's own `--cache=false`
option controls its instrumentation cache independently of esm-sync's compiler
cache.

The tests run the installed NYC, Mocha, Babel, ts-node, and proxyquire packages in real
Node subprocesses. Coverage checks assert executed and unexecuted functions,
branch counts, and original source lines, including after ordinary runs have
warmed the compiler cache.

## CommonJS mocking hooks

When a CommonJS hook is installed on a `.js` interop graph, interception belongs
to each importer. In the covered mock-loading paths, a mock is selected before
the real dependency body executes, and another import of the same dependency
cannot replace that importer's mock bindings. Discarded linking
records must not survive into a later mock session after its cache reset.

Use CommonJS interop options, such as `{ cjs: true, mode: "auto" }`, with tools
that intercept `Module._load`, override extension handlers, or manage exposed
module-cache entries. Regression tests cover proxyquire's local/global stubs
and unused named imports. Minimal tests also exercise the `Module._load` and
cache-reset protocol described in the rewiremock report; they do not run the
historical rewiremock package itself.

Internal `.mjs` import graphs retain strict ES module behaviour and bypass
CommonJS `Module._load` mocking. Their evaluation order, cycles, and namespace
rules remain intact. A CommonJS hook may intercept a top-level `require()` before
the request reaches the loader; that does not enable interception within an
`.mjs` import graph. Use `.js` interop graphs for CommonJS mocking frameworks.
