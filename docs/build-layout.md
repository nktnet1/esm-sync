# Build layout

Generated JavaScript, native binaries, diagnostics, and disposable test workspaces
live under `dist/`. Maintained TypeScript and compatibility fixtures stay in their
source directories. Prepared Acorn/Test262 corpora are downloaded build inputs,
not generated JavaScript.

| Maintained input | Generated output |
| --- | --- |
| `src/bootstrap/esm.ts`, `src/bootstrap/index.ts` | `dist/esm.js`, `dist/index.js` |
| `src/index.ts` | `dist/esm/loader.js` |
| Standalone compiler/runtime entries | `dist/build/*.js` with `--test` |
| `script/src/*.ts` commands | `dist/script/` |
| `script/src/build-sync-await.ts` | Public `dist/script/build-sync-await.js` and private `build-sync-await-dev.js` |
| `native/sync-await.cc` | `dist/native/<platform>-<arch>-<ABI>.node` |
| `test/harness/` and maintained test inputs | Disposable `dist/test/` |
| `debug/*.ts` | `dist/debug/` |

The native TypeScript CLI prepares a fresh test workspace before build, test, and
conformance commands. It copies fixtures, corpus inputs, and environment files;
the harness emitter then writes its JavaScript there. Fixture compilers, native
addons, caches, and child-process executables write into this disposable copy.
Tests never need generated files beside maintained fixtures. A development-only
`dist/node_modules` junction points to the installed workspace dependencies and
is excluded from the published package.

`package.json` points at `dist/esm.js`. Its explicit `files` list includes the
public bootstrap, loader, installer, native binaries, maintained declaration, and
C++ source. Development tooling and test workspaces are excluded. Package exports
preserve the existing `esm`, `esm.js`, `index`, and `index.js` aliases. CommonJS,
native ESM, CLI preload, tarball installation, and Verdaccio installation exercise
the published layout, including native compilation from the installed source.
Alias exports also point at the maintained declaration file, so the layout change
preserves their TypeScript contracts without emitting duplicate declarations.

Native miscellaneous suites run with a symlinked temporary directory in both
cache modes. Resolver assertions use a canonicalised `mkdtemp` directory, catching
macOS `/var` versus `/private/var` assumptions on Linux as well. The repository's
`AGENTS.md` records this path-comparison rule for future changes.

The native TypeScript CLI and checking helpers in `script/src/esm/` execute from
source and are not emitted. Their private ESM package config stays in source.
The CLI explicitly awaits the complete registry task. Registry and publish tasks
invoke already-prepared build helpers instead of regenerating executing commands.
Registry success is reported after teardown, and an incomplete exit is an error.
Tooling's no-emit check uses ES2022 for the native CLI's top-level await; the
emitter and tsdown still enforce ES2015 generated JavaScript.

`.ncurc.mjs` is a maintained, tracked configuration. It is not emitted or deleted
by development commands. Other main tool configs stay at the root, with secondary
configs under `config/`.

## Minification and the Oxc evaluation

tsdown's native Oxc minifier handles production JavaScript. The old publish-time
HTML minifier only compressed README tables; it was unnecessary for runtime or
tests and has been removed. tsdown does not minify HTML, so publishing simply
retains the maintained README.

The remaining Babel replacement evaluation is complete. A direct comparison of
the installed Rolldown/Oxc transformer with the retained Babel configuration gave
different observable results for ordinary function `this` and non-null equality:

| Probe | Required/Babel | Oxc with `target: "node6"` |
| --- | --- | --- |
| Ordinary function sees `this === undefined` | `true` | `false` |
| Explicit `"use sloppy"` function sees its receiver | `true` | `true` |
| Comparison of `"1" == 1` after the custom equality transform | `false` | `true` |

Oxc's target lowering does not implement these project-specific transformations.
Removing Babel would change loader behavior. The custom Babel pass therefore
remains; tsdown continues to own bundling, public TypeScript emission, and native
minification. `build-transforms.test.ts` protects the strict/sloppy and equality
contracts. See the upstream [Oxc lowering](https://oxc.rs/docs/guide/usage/transformer/lowering)
and [transformer plugins](https://oxc.rs/docs/guide/usage/transformer/plugins) references.
