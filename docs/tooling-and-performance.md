# Tooling and performance investigations

This documents the reproducible portions of the upstream issues in the
[roadmap](FORK_ISSUES_ROADMAP.md). The fixtures execute in real Node subprocesses
under `test/vitest/fork-tooling-performance.test.ts`. They run in Vitest's
**tooling** project (the Ubuntu/Node 24 CI job), not in every OS/Node matrix job.
Passing them is not certification of an untested integration or a newer version
of a third-party tool.

## Startup measurement (#844)

Build the fork before measuring, then run:

```sh
pnpm benchmark:startup --iterations=7
pnpm benchmark:startup --iterations=7 --json
```

The script uses the _same 16-module graph_ in two equivalent forms: `.mjs` for
native Node and `.js` for the esm-sync preload. For each iteration it measures:

- **Native:** A new Node process importing the native `.mjs` graph.
- **esmCold:** A new Node process with an empty esm-sync compiler-cache directory.
- **esmWarm:** Another new Node process using the compiler cache produced by
  that iteration's cold run.

The measurements are subprocess wall times (including Node startup), in
milliseconds. Output includes individual samples and medians; `--json` supports
repeatable collection in a benchmark environment. The script ensures the
loaded code returns the expected result and that the cold run creates a cache.
It removes the test fixtures and cache afterwards.

Do not turn these measurements into CI pass/fail thresholds. Operating-system
file caches and other process activity affect wall times. In particular, the
native baseline does not have an analogous persistent compiler cache. Issue
#844 described a real application's startup regression; that application's
dependency graph has not been supplied or benchmarked here. A change should
be justified by before/after runs on the **same hardware and Node version**.

## Jest and Babel transformations (#779, #875, #706)

Using the fork's installed Jest **26.6.3**, a CommonJS Jest test can call the
esm-sync loader factory to load an ES module. The same test runs an ESM module
that imports `node:fs` and calls `readFileSync`, while Jest also applies an
explicit custom transformer to the test file.

These are three specific, passing integration checks. They do **not** establish
that the historical protobufjs `util.fs` initialization bug is fixed, that
esm-sync itself implements Jest's `process`/`getCacheKey` transformer API, or
that Jest 29/30 and their ESM runtimes are supported. Revisit these issues
with current-version Jest and the original protobufjs reproduction before
changing their roadmap status.

## Top-level await and aliases (#810)

The covered graph imports a package via its `exports` entry and evaluates
top-level `await`, alongside an unrelated CommonJS `module-alias` registration.
This confirms both features can coexist in one process, **not** that a
CommonJS `module-alias` registration changes the resolution of ES module
imports. The latter is intentionally a different resolution path. In the
investigation, an ES module import of a `module-alias`-only specifier produced
`ERR_MODULE_RESOLUTION_LEGACY`; an untransformed package `#imports` alias also
failed through the fork's loader. Do not present either as a working ESM alias.

The upstream report used `babel-plugin-module-resolver`, not `module-alias`.
The original transform pipeline and its top-level-await handling remain to be
reproduced before closing #810. Ordinary package-name imports work in the
covered case; this is not equivalent to a Babel rewrite or a Node `#imports`
alias.

## `mainFields` and TypeScript hooks (#794)

The integration tests exercise a package with both `module: "./src/index.ts"`
and `main: "./dist/index.js"`, plus a second package with only `main`. With
`mainFields: ["module", "main"]`, esm-sync resolves the TypeScript source of
the first package and falls back to `main` for the second.

The same fixture passes with `ts-node/register` and with `@babel/register`
configured to process the fixture's simple typed source. When using ts-node,
`TS_NODE_SKIP_IGNORE=true` is required to transform `.ts` under `node_modules`
(the location of the reported package). `ESNext`/`Bundler` are the test's
compiler options; `TS_NODE_TRANSPILE_ONLY` and `TS_NODE_SKIP_PROJECT` keep the
fixture independent of the monorepo's TypeScript configuration.

This reproduces the essential custom-main-field and registered-extension
behaviour without requiring the original monorepo's private packages. It does
not imply that arbitrary TypeScript syntax can be transformed by Babel's Flow
plugin, or that arbitrary compiler hooks will compose in every order.
