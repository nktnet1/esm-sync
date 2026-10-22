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

## Focused Test262 investigations

The Test262 corpus is downloaded by `pnpm fixtures:test262` and is pinned to
its recorded revision. It is intentionally **not** installed as an npm package.
Use `pnpm test:conformance` to prepare it, build the loader, and execute the full
selected suite. This run currently has known failures, so a non-zero exit code
is expected until those issues are addressed.

Once fixtures and the test loader are ready, use `pnpm test:conformance:run` to
rerun without downloading or rebuilding. The runner accepts these options:

- `--filter <path>` selects tests whose repository-relative paths contain the
  supplied text, ignoring case. This works with either `/` or `\` separators.
- `--limit <number>` runs the first N matching, non-excluded cases in stable
  path order. An unmatched filter is an error, never a successful empty run.
- `--report <file>` writes a JSON report containing the corpus revision, Node
  runtime, selected and skiplist-excluded counts, separate passed, failed,
  and unsupported counts, per-case outcomes, and failing directory groups.
  Unsupported cases remain selected, have their required host features listed,
  and appear as skipped in Node's test output. The `complete` field indicates
  whether all selected cases produced results. A failing suite still writes
  its report.
- `--reporter spec|dot|tap` selects a built-in Node test reporter. For a full
  suite, `dot` produces less console output than `spec`.

For example, a targeted rerun without a rebuild:

```sh
pnpm test:conformance:run --filter module-code --limit 20 --report .cache/test262-module-code.json
```

A report's group names describe *test file locations*, not proven root causes.
The existing harness compares thrown error types but does not yet distinguish
Test262's parse, resolution, and runtime negative-test phases. The selected
cases, feature support, and Node host behaviour must therefore be evaluated
before interpreting any apparent pass percentage as full ECMAScript conformance.

### Conformance re-audit (22 October 2026)

Before host-feature gating, Linux x64 with Node 24.21.0 reported **1,739
selected cases: 1,473 pass, 266 fail, and 6 excluded**. This builds on the
previous deferred-import and module-mode fixes. The latest skiplist review
re-enabled 15 dynamic-import module tests and 6 module early-error tests:
all 21 pass in the full suite without regressions. The same restored cases
also pass targeted runs under Node 26.12.0.

All six remaining exclusions are script-goal dynamic-import tests. They need
a script-aware harness instead of importing the test file as a module. The
runner also checks expected error **types**, not their declared parse,
resolution, or runtime **phases**, so an apparent pass is not a complete
conformance guarantee.

Of the 266 failures, 242 live under `top-level-await` and another 14 involve
async module evaluation elsewhere. The other ten include five import-bytes
cases requiring immutable array buffers, three source-phase binding cases,
one deferred-namespace evaluation-error identity case, and one private-brand
case whose host private-field behaviour differs from Test262's expectation.
They should be investigated individually rather than added to the skiplist.

### Host-feature classification and deferred error recovery

The Test262 runner checks two engine capabilities before running cases that
require them: `immutable-arraybuffer` and `nonextensible-applies-to-private`.
A failing capability probe makes the dependent test an **unsupported** Node
skip, not a conformance failure. These cases remain in the selected count and
JSON report with `status: "unsupported"` and `unsupportedFeatures`; they are
not added to the permanent skiplist. A host implementing the feature will run
those tests normally.

The pinned corpus now reports **1,739 selected: 1,474 passed, 259 failed,
6 unsupported, and 6 separately excluded** on Node 24.21.0. The one new
passing case checks that a deferred namespace preserves the exact value
thrown by an already-errored module rather than rejecting during deferred
import linking. The other six former failures are accurately classified as
host-unsupported: five import-bytes tests need immutable ArrayBuffers, and
one private-brand test requires private fields to respect non-extensibility.
Node 24.21.0 and 26.12.0 lack both capabilities in the supplied runtimes.

The private-brand behaviour is controlled by the JavaScript engine's private
field operations and cannot be corrected through proxy traps. These feature
gates do not skip source-phase or async module evaluation failures.

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
