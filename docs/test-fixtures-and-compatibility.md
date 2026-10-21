# Test fixtures and interoperability coverage

## Reproducible fixtures

- `pnpm fixtures:acorn` prepares the vendored Acorn source matching the installed
  `acorn` package version. `pnpm build --test` checks this before bundling.
- `pnpm fixtures:test262` prepares a selected Test262 corpus at commit
  [`d53ebc8b1931d9f1541e43d59650776e4b766248`](https://github.com/tc39/test262/commit/d53ebc8b1931d9f1541e43d59650776e4b766248).
  It fetches that **exact SHA**, not the moving `main` branch. The preparation
  records `.prepared-revision` and rejects missing or older corpus directories.
  Failed downloads or transformations do not replace a previously prepared
  corpus. To intentionally update Test262, review the new SHA, update
  `script/setup-test262.js`, and verify the selected corpus against the loader.
- `pnpm fixtures:prepare` prepares Acorn and Test262 together; `pnpm test` and
  `pnpm test:prod` prepare the fixtures, rebuild, and execute the Vitest suite.
- `pnpm test:run` and `pnpm test:run:prod` reuse an existing JavaScript test
  build and vendor sources without downloading or rebuilding either. CI runs
  them after explicit preparation and building. Test execution may still clear
  caches and compile the local Node-API native-addon test fixture.

Run `pnpm test:conformance` to prepare the pinned Test262 corpus, build the test
loader, and execute the conformance suite separately from Vitest. Each case runs
in its own Node subprocess with `--harmony`. The existing Test262 skiplist is
reported as excluded cases rather than silently passing, and the runner fails
if no runnable cases are found. The conformance suite is intentionally not part
of the default Vitest matrix. Likewise, the Acorn source corpus is vendored for
compilation, rather than counted as Vitest cases.

## Third-party runner dependencies

The following are deliberately retained for **external host interoperability**,
not for the internal test runner. `test/scenario-tests.mjs` runs each scenario
in a real Node subprocess through Vitest's native-suite adapter.

| Dependency | Exercised by | Reason for retention |
| --- | --- | --- |
| `mocha` | Mocha CLI, Mocha + NYC, Chai + Mocha + NYC | Loader preloads, instrumentation and CommonJS test hosts |
| `jest` | Module-cache, console, mock-require and cycle scenarios | Jest's custom resolver and VM/module isolation |
| `ava` | AVA bridge/CLI, core-js, NYC, Sinon, TypeScript scenarios | Loader interoperability with AVA and its process/worker model |
| `jasmine` | Jasmine helper/config scenario | Loader handling of Jasmine's external test process |
| `@hapi/lab` | Lab, Lab + Babel register scenarios | Lab's CLI and register-hook integration |
| `nyc` | NYC with standalone loader, Mocha or AVA | External coverage instrumentation compatibility |
| `ts-node` | Register and transpile-only scenarios | TypeScript compiler-API interoperation; requires TypeScript 6.x |
| `@babel/register` | Babel-error, Babel/Flow, Lab and PM2 scenarios | Third-party register-hook coexistence; not internal compilation |
| `webpack` | Webpack config-register scenario | Legacy external bundler host, distinct from the primary build |

Some additional **Jest context/global** and **Babel + Mocha + NYC** cases are
explicitly skipped due to historical limitations. They do not justify keeping
packages by themselves; the passing scenarios above do. Remove a host dependency
only together with a deliberate retirement of its passing compatibility test.

On Node 22.10–22.17 and Node 23, the old `esm` package bundled by AVA 1 and the
separate `@std/esm` package call the obsolete one-argument
`process.binding("fs").internalModuleStat`. These runtimes abort the native
process when the binding receives too few arguments. Only those external-host
scenarios are version-gated on the affected minors; the tests remain active on
Node 22.18+, 24 and 26. This does not change the published loader API.

## Runtime support policy before Phase 8

Keep Node 22 in CI and test the loader under Node 24 and 26. Preserve the
published `engines.node: ">=6"` range for now; no increase in the minimum Node
version is implied by updating the **development** toolchain. The old runtime
range is not an assertion that the new development scripts run on Node 6.

The loader contains compatibility and semantic adapters in `src/module/`,
`src/hook/`, `src/builtin/`, and `src/util/`, including implementations of Node
module internals and copied formatting/inspection behaviour. Even where code
originally targeted Node 6, those adapters also implement observable loader
behaviour. Do not delete them solely because newer Node versions have built-ins;
review them with functional parity tests during Phase 8. The `src/fs/stat-fast.js`
version check also remains relevant to Node 22.x and 23.x internals.
