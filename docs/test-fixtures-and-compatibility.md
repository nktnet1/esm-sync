# Test fixtures and compatibility

## Preparing fixtures and running tests

| Command | Purpose |
| --- | --- |
| `pnpm fixtures:acorn` | Prepare Acorn sources matching the installed package |
| `pnpm fixtures:test262` | Prepare the pinned Test262 selection |
| `pnpm fixtures:prepare` | Prepare both corpora |
| `pnpm test` | Prepare fixtures, build, and run Vitest |
| `pnpm test:prod` | Run the same flow against production output |
| `pnpm test:run:prod` | Reuse an existing production test build |
| `pnpm test:conformance` | Prepare, build, and run the selected Test262 suite |

The Test262 revision is pinned in `script/src/setup-test262.ts` to
[`d53ebc8b1931d9f1541e43d59650776e4b766248`](https://github.com/tc39/test262/commit/d53ebc8b1931d9f1541e43d59650776e4b766248),
not the moving `main` branch. The setup script records the prepared revision,
checks required directories, and avoids replacing valid fixtures when a download
fails. Change the pinned SHA only after reviewing and validating the selection.
Builds also prepare Acorn automatically when its vendor source is missing.

Test commands run maintained harness TypeScript as emitted JavaScript under
`dist/test/`. The workspace is disposable. External runner scenarios execute in
real subprocesses with isolated disk caches. Native filesystem assertions must
compare canonical paths; see `AGENTS.md` for the macOS symlink rule.

## Published package tests

`pnpm test:packed --format=both` packs and installs the package in a disposable
consumer and exercises CommonJS and ESM loading. The default format is `cjs`;
`--format=esm` selects ESM checks. This test installs with scripts disabled, so
it does **not** validate native compilation at installation.

`pnpm test:verdaccio` builds, packs, publishes to a temporary local Verdaccio
registry, and installs into **separate** `"type": "commonjs"` and
`"type": "module"` projects. It checks the installed files and native bridge,
rebuilds the bridge from the published C++ source, and runs four primary checks:

- CommonJS project importing CommonJS and ESM modules.
- ESM project importing CommonJS and ESM modules.

Seven additional checks run in each project: native `require()`/`import()` and
`createRequire()`, mixed dependency graphs, extension/package boundaries,
conditional exports, published entry aliases, caching/live bindings, and CJS/ESM
worker threads. The CommonJS project also tests CLI preload. Each test runs in
its own Node process so a failure identifies the exact combination.

Options: `--format=cjs|esm|both` (default `both`), `--verbose` for child logs,
and `--worker-rounds N` (1–50, default 1) for repeated concurrent worker checks.
Verdaccio requires registry access to install the temporary server and resolve
runtime dependencies; it is not a workspace development dependency. The
registry, credentials, consumer projects, and caches are discarded afterwards.

## Test262 conformance

`pnpm test:conformance:run` reuses the prepared corpus and test build. The
runner executes each selected case in its own Node subprocess and checks
negative-test **error types and phases**. Script-goal cases retain `vm.Script`
semantics; module-goal cases use esm-sync's parse/link/validate path before
evaluation. Host or loader features that are unavailable are reported as
*unsupported*, not passed or silently excluded.

Useful selection and reporting options:

- `--filter <path>`: select paths containing a case-insensitive substring.
- `--limit <count>`: bound the number of selected cases.
- `--exclude-feature <feature>`: omit a Test262 feature for this run (repeatable).
- `--report <file>`: write JSON results, including unsupported and failure groups.
- `--reporter spec|dot|tap`: choose the Node test reporter.

For example:

```sh
pnpm test:conformance:run --filter module-code --limit 20 --report .cache/test262-module-code.json
```

The conformance suite is separate from default Vitest because of its size.
Its selection and error-phase assertions should not be weakened to conceal
unsupported host capabilities or runtime failures.

## External host scenarios

Mocha, Jest, AVA, Jasmine, Lab, NYC, `ts-node`, `@babel/register`, and Webpack
are retained to test compatibility with their actual CLI processes, register
hooks, module caches, coverage tools, and resolvers. Changes to these
dependencies should keep their corresponding passing scenarios. The documented
runtime range (`node >=6`) is legacy package metadata; current development
scripts and native bridge targets must not be assumed to run on Node 6.
