# Tooling and performance

The integration fixtures run in real Node subprocesses in
`test/vitest/fork-tooling-performance.test.ts`. CI runs this file in the
**tooling** project on Ubuntu/Node 24. The installed Jest version is **26.6.3**;
the installed protobufjs version used by the regression is **7.6.6**.

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

| Build                     | Native | esmCold | esmWarm |
| ------------------------- | -----: | ------: | ------: |
| Supplied `08490c57`       | 102.46 |  368.38 |  264.04 |
| Cache fixes in this patch |  91.90 |  322.88 |  217.80 |

The changing native baseline demonstrates measurement noise. These figures are
not CI thresholds or a promised speedup. The original application's reported
10-to-30-second regression still needs its application graph and equivalent
before/after measurements; fixing these cache faults does not establish that
application's startup time.

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

Babel must preserve import/export and top-level await for esm-sync to link and
evaluate the graph. Register Babel before creating the loader factory, use
`@babel/preset-env` with **`modules: false`**, and use `.js` sources handled by the
registered extension hook. Configure the alias plugin in that Babel pipeline.

A real `@babel/register` regression rewrites an aliased import and re-export,
then loads a dependency with top-level await and awaits its value in the
importer. It passes in cold and warm loader processes. Its small fixture plugin
performs the source rewrite; **the original `babel-plugin-module-resolver`
package and repository were not available and were not run**. That exact
integration therefore remains open in the roadmap.

The separate `module-alias` fixture confirms that a CommonJS alias can coexist
with an unrelated ESM graph. It does not make CommonJS-only aliases part of
strict ESM resolution. Node `#imports` mappings through the fork are also not
established as supported by these fixtures.

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
