# Test fixtures and interoperability coverage

## Reproducible fixtures

- `pnpm fixtures:acorn` prepares the vendored Acorn source matching the installed
  `acorn` package version. `pnpm build --test` checks this before bundling.
- `pnpm fixtures:test262` prepares a selected Test262 corpus at commit
  [`d53ebc8b1931d9f1541e43d59650776e4b766248`](https://github.com/tc39/test262/commit/d53ebc8b1931d9f1541e43d59650776e4b766248).
  It fetches that **exact SHA**, not the moving `main` branch. The preparation
  records `.prepared-revision` and rejects missing or older corpus directories.
  The selection includes both resource-management statement groups and retains
  all ten module-goal cases. A marked older subset missing either group must
  be prepared again.
  Failed downloads or transformations do not replace a previously prepared
  corpus. To intentionally update Test262, review the new SHA, update
  `script/src/setup-test262.ts`, and verify the selected corpus against the loader.
- `pnpm fixtures:prepare` prepares Acorn and Test262 together; `pnpm test` and
  `pnpm test:prod` prepare the fixtures, rebuild, and execute the Vitest suite.
- `pnpm test:run` and `pnpm test:run:prod` reuse an existing JavaScript test
  build and vendor sources without downloading or rebuilding either. CI runs
  them after explicit preparation and building. Test execution may still clear
  caches and compile the local Node-API native-addon test fixture.

Nested third-party scenario processes (including AVA and Flow tooling) now
receive **separate disk-cache paths**. Previously their explicit `ESM_OPTIONS`
reset the surrounding native suite's cache setting, so concurrent processes
could write V8 cached data into the same default directory. This retains
caching and all integration assertions rather than disabling either. The
historic CI log supplied for this issue is from **Windows / Node 26**, not
macOS, and contains V8 `unreachable code` crashes in the cached scenario
suite; a cross-platform CI rerun is needed to confirm whether eliminating
cache contention resolves those runner-specific failures.

PM2 v7.0.4 also has an independent **three-second** default for
`--wait-ready`. Once that expires, PM2 can report an application as `online`
without having received its `ready` IPC message. The Babel-register bridge
can exceed that deadline on slower CI hosts, while the test's separate log
poll previously stopped after ten seconds. The PM2 scenarios now use an
explicit, shared 30-second readiness deadline and still require the original
IPC acknowledgment, stdout marker, online state, and Node version. A temporary
15-second startup-delay reproducer failed the original test with an empty
readiness log but passed with the aligned deadlines. On a failure, the test
also reports PM2's process state and the daemon-log tail. This validates the
timeout failure mode; it is not yet a macOS CI confirmation.

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
selected suite. Failures produce a non-zero exit code; unsupported host or loader
capabilities are reported separately. Current async behavior and validation are
recorded in [async module loading](async-module-loading.md); the dated audits
below describe earlier snapshots.

The v1.0.2 re-audit on Linux / Node 24.21.0's production build reports **1,755
selected: 1,746 passed, 0 failed, 9 unsupported, 0 excluded**. All twelve reported
failures now pass. Every previously selected case,
expected error, and expected phase is retained; ten module-goal resource cases
are added from the same pinned revision. Script-goal imports now exercise
esm-sync's runtime inside `vm.Script`, preserving their global scope and import
Promise identity. The nine unsupported cases comprise six host capabilities
(five immutable ArrayBuffer cases and one private-field case) and three
ModuleSource binding cases; they are not async failures or new exclusions.

Once fixtures and the test loader are ready, use `pnpm test:conformance:run` to
rerun without downloading or rebuilding. The runner accepts these options:

- `--filter <path>` selects tests whose repository-relative paths contain the
  supplied text, ignoring case. This works with either `/` or `\` separators.
- `--limit <number>` runs the first N matching, non-excluded cases in stable
  path order. An unmatched filter is an error, never a successful empty run.
- `--exclude-feature <name>` excludes cases with the exact Test262 feature tag
  from this run (repeatable). This is selection only: excluded-by-feature cases
  are not marked passing, unsupported, or permanently skipped. The default
  run still selects all features.
- `--report <file>` writes a JSON report containing the corpus revision, Node
  runtime, selected and skiplist-excluded counts, separate passed, failed,
  and unsupported counts, per-case outcomes, and failing directory groups.
  Unsupported cases remain selected, identify missing host and loader features
  separately (in `unsupportedFeatureSources` and `unsupportedByOrigin`), and
  appear as skipped in Node's test output. The `complete` field indicates
  whether all selected cases produced results. A failing suite still writes
  its report.
- `--reporter spec|dot|tap` selects a built-in Node test reporter. For a full
  suite, `dot` produces less console output than `spec`.

For example, a targeted rerun without a rebuild:

```sh
pnpm test:conformance:run --filter module-code --limit 20 --report .cache/test262-module-code.json
```

The nine deferred-import error cases without top-level await can be checked separately
from the three top-level-await-dependent cases with:

```sh
pnpm test:conformance:run --filter import/import-defer/errors/ --exclude-feature top-level-await
```

The three await-dependent cases remain runnable without the filter, and
are not reclassified as unsupported. As of v1.0.10, the complete 12-case
deferred-error group passes 9 and fails 3, all three tagged
`top-level-await`. Two older deferred-error failures already pass after the
earlier runtime and harness fixes; no additional synchronous runtime defect
was reproduced in this group.

The regular Vitest suite also runs the 76 pinned `module-code/instn-` cases as
a focused conformance regression. It requires all 58 positive cases and 18
resolution-negative cases to pass; a reduced selection or unsupported
classification cannot silently satisfy this check.

A report's group names describe *test file locations*, not proven root causes.
The harness now compares both the declared negative-test **error type and
phase**. Parse-negative cases are checked without evaluation, using the
esm-sync compiler for modules and `vm.Script` for scripts. Module cases then
run esm-sync's own loader through its linking/validation pass without module
evaluation; only after a successful link may runtime cases execute. The
wrapper fails closed if that private, test-only phase bridge is unavailable.
Script-goal
parse negatives use both esm-sync's script parser and Node's VM parser on
the **compiled** script: this catches ordinary syntax errors skipped by the
compiler's fast path, while accepting phase modifiers that older V8 versions
cannot parse natively and rejecting invalid forms such as
`new import.source(...).prop`. Two generated top-level `import.source()`
syntax-positive cases use an intentionally unresolvable `<module source>`
placeholder and contain no runtime assertions; these are parsed without
execution and tagged `syntaxOnly: true` in JSON reports. Other `syntax/valid`
cases still execute their assertions. Async
tests wait for `$DONE`, reject its error argument or duplicate calls, and
surface unhandled rejections and timeouts instead of treating print output as
success. The follow-up full-corpus results are recorded in the 23 October audit below.

### Conformance re-audit (22 October 2026)

Before host-feature gating, Linux x64 with Node 24.21.0 reported **1,739
selected cases: 1,473 pass, 266 fail, and 6 excluded**. This builds on the
previous deferred-import and module-mode fixes. The latest skiplist review
re-enabled 15 dynamic-import module tests and 6 module early-error tests:
all 21 pass in the full suite without regressions. The same restored cases
also pass targeted runs under Node 26.12.0.

At that snapshot, all six remaining exclusions were script-goal
dynamic-import tests. Script-goal execution and fixture-module loading have
since restored all six. Phase-aware validation was added subsequently, as
described above; the older conformance totals predate that validation.

Of the 266 failures, 242 live under `top-level-await` and another 14 involve
async module evaluation elsewhere. The other ten include five import-bytes
cases requiring immutable array buffers, three source-phase binding cases,
one deferred-namespace evaluation-error identity case, and one private-brand
case whose host private-field behaviour differs from Test262's expectation.
The unsupported host cases and deferred-error identity case were addressed in
v1.0.4. The source-phase ModuleSource cases are now classified separately as
unsupported loader capabilities, rather than placed on the permanent skiplist.

### Host-feature classification and deferred error recovery

The Test262 runner checks two engine capabilities before running cases that
require them: `immutable-arraybuffer` and `nonextensible-applies-to-private`.
A failing capability probe makes the dependent test an **unsupported** Node
skip, not a conformance failure. These cases remain in the selected count and
JSON report with `status: "unsupported"` and `unsupportedFeatures`; they are
not added to the permanent skiplist. A host implementing the feature will run
those tests normally.

At the v1.0.4 baseline, the pinned corpus reported **1,739 selected:
1,474 passed, 259 failed, 6 unsupported, and 6 separately excluded** on
Node 24.21.0. The one new
passing case checks that a deferred namespace preserves the exact value
thrown by an already-errored module rather than rejecting during deferred
import linking. The other six former failures are accurately classified as
host-unsupported: five import-bytes tests need immutable ArrayBuffers, and
one private-brand test requires private fields to respect non-extensibility.
Node 24.21.0 and 26.12.0 lack both capabilities in the supplied runtimes.

The private-brand behaviour is controlled by the JavaScript engine's private
field operations and cannot be corrected through proxy traps. The host-feature
gates do not skip async module evaluation failures.

### Source-phase ModuleSource capability

esm-sync parses source-phase import syntax but does not expose a JavaScript
`ModuleSource` representation. The runner therefore declares the loader
capability `source-phase-imports-module-source` unsupported. The feature tag
also appears on **105 syntax-only tests**, so the runner keeps parsing tests
(active cases under `/syntax/` and parse-negative tests) enabled even when
they carry this tag. It also keeps the broader `source-phase-imports` feature
active. Only three non-syntax cases in the pinned corpus require ModuleSource
values for named imports, namespace access, and non-ambiguous re-exports;
those cases appear as unsupported loader cases, not conformance failures or
passes.

The unsupported declaration belongs in `detectLoaderFeatures()` and should be
changed only when ModuleSource support is implemented and independently tested.
The JSON report keeps the existing `unsupportedFeatures` list for compatibility
and additionally provides per-case `unsupportedFeatureSources` (`host` and
`loader` arrays) and report-level `unsupportedByOrigin` counts. These counts
can overlap if a testcase requires both kinds of unavailable capability.
The full Test262 corpus has **not** been rerun after the harness changes, so
older pass/failure totals above remain historical rather than a current baseline.

### Test262 resolution-phase validation

The Test262 wrapper parses the root using esm-sync's compiler and now validates
module graphs through **esm-sync's own parse/link/validate pass** instead of
creating a separate `vm.SourceTextModule` graph. The root source is parsed
before instantiation; syntax errors discovered in transitive dependencies
belong to the resolution phase of the root Test262 case, including deferred
module imports. A test-build-only private bridge invokes the existing loader
without its subsequent evaluating load.
Module-mode `.js` fixtures use `mode:all` scoped to their own graph. Cyclic
imports and deep missing/ambiguous exports are therefore checked using the
same resolver and binding machinery as normal esm-sync imports.

A resolution-negative case **stops after linking**, regardless of success;
a body throwing the expected error type cannot disguise a successful link.
Positive module cases and runtime-negative module cases are linked first and
only then evaluated using the **same internal esm-sync loader**. The Test262
bridge does not pass syntax-free `.js` modules through Node's `require()`
entry point, which could execute them as CommonJS instead of respecting
Test262's module goal. This also keeps runtime error attribution on the
same loader as link validation, rather than letting a second, native Node
linking pass masquerade as a runtime error. An inability
to initialise the private validation bridge fails the runner rather than
masquerading as a Test262 error. The JSON report schema and unsupported
feature classifications are unchanged. Top-level await and ModuleSource
support remain outside this change.

### Test262 script goal and module fixtures

Non-module Test262 cases now execute using `vm.Script`, preserving their
script-goal semantics. Test262 `*_FIXTURE.js` files imported from the pinned
`test/language` corpus are treated as ES modules even when they contain no
import/export syntax. A scoped Node module-load hook avoids the synthetic
`default` export that Node would otherwise add when interpreting such a file
as CommonJS. The hook leaves files outside the prepared Test262 corpus alone,
including ordinary application CommonJS modules.

After the script-goal change restored one excluded case, the fixture-loading
fix restores the other five dynamic-import namespace cases. The skiplist is
now empty. These cases are covered by targeted Vitest subprocess regressions;
a full-corpus rerun after these changes is recorded in the 23 October audit below.

The Test262 `module` flag also requires syntax-free `.js` files to retain
module semantics inside a `"type": "commonjs"` package. In particular, the
loader must not delegate a zero-transform `.js` file to Node's native
CommonJS extension handler when `mode: all` is explicitly set. The same rule
prevents dependencies from evaluating during resolution-only checks. Ordinary
CommonJS extension passthrough remains available outside that forced mode.

The private Test262 bridge also canonicalises the test filename **before**
caching forced module options. The resolver follows symlinks by default, so
paths such as macOS `/var/folders/...` and `/private/var/folders/...` otherwise
receive different package-cache entries. Without this alignment, a syntax-free
`.js` case could fall back to CommonJS or execute during the link-only pass.
The regression suite exercises symlinked entry paths, their dependencies, and
resolution-only checks while preserving the original assertions.

### Test262 conformance audit (23 October 2026)

The complete pinned selection on **Linux / Node 26.12.0**, both before
and after the module-goal bridge correction, recorded **1,745 selected:
1,352 passed, 384 failed, 9 unsupported, 0 excluded**. The failing cases fall
into four source-path groups: 242 under `module-code/top-level-await`, 111
under `expressions/dynamic-import`, 22 other `module-code` failures, and 9
under `import/import-defer`. Directory groups do not establish individual
root causes: the dynamic-import group includes deferred-import and
source-phase cases, while most of the remaining import-defer failures
involve top-level await.

The 22 non-await `module-code` failures were all **parse-negative** tests.
esm-sync's compiler deliberately tolerates some early errors, so compiler-only
preflight accepted invalid module sources. The Test262 bridge now also parses
the **transformed module text** with `vm.SourceTextModule` (without calling
`link()` or `evaluate()`). This preserves the module goal and catches early
errors that the tolerant compiler allows, without introducing another linker.
Valid newer syntax such as `import defer` and `import.source()` is first
transformed by esm-sync so older Node parsers do not reject the raw syntax.
The nine unsupported cases are reported separately (five immutable
ArrayBuffer, one private-field host-semantic, three ModuleSource-binding).

After the module-goal bridge correction, **108/108** `instn-` cases and
**341/366** module-code cases selected without the `top-level-await`
feature pass in that baseline, with 22 parse-phase failures and three
unsupported cases. After the parse-only validation fix, the same 366-case
selection reports **363 passed, 0 failed, 3 unsupported**. No cases were
excluded or converted into unsupported results.

The complete pinned 1,745-case selection after this fix reports **1,375
passed, 361 failed, 9 unsupported, 0 excluded** on Linux / Node 26.12.0.
Compared with the preceding run, exactly 23 parse-negative cases changed from
failure to pass (the 22 module-code cases above and one top-level-await early
error), with **no newly failing cases**. The remaining failures are 111 in
`expressions/dynamic-import`, 9 in `import/import-defer`, and 241 under
`module-code/top-level-await`. This validation changes only the private
Test262 harness, not the production compiler's tolerant parsing contract.

### Generated dynamic-import grammar validation (v1.0.18)

The pinned corpus contains generated `expressions/dynamic-import/syntax/valid`
script cases which deliberately perform imports such as `import("")` or
`import("<module source>")` without inspecting the returned promises. Node
26 treats the ensuing unobserved rejections as fatal process errors. Those
cases test whether the script *parses*, not whether the synthetic specifier
resolves. The Test262 selector now recognises **only** generated cases with
pinned `syntax/valid` template provenance, no completion callback, no runtime
assertions or explicit throws, and no additional harness includes or negative
expectations. These cases use the existing compiler + `vm.Script` parse-only
path. Generated cases with runtime checks (notably `with (import(...))`) and
ordinary positive/negative cases still execute normally.

The full pinned **1,745-case** rerun on Linux / Node 26.12.0 reports
**1,453 passed, 283 failed, 9 unsupported, 0 excluded**. Exactly 78 cases
changed from failure to pass relative to the v1.0.17 report, with zero new
failures. The remaining 33 under `expressions/dynamic-import` include 16
`import.defer` rejection tests, 7 syntax-valid cases with actual runtime
assertions, 4 tests involving deferred async modules, 3 for-await evaluation
failures, and 3 other cases (unobserved runtime imports, text import
attributes, and an errored cycle). The other remaining groups are 241
`module-code/top-level-await` and 9 `import/import-defer`. This change fixes
conformance **reporting for generated grammar tests**, not runtime dynamic
import or async module evaluation.

### Script-goal dynamic `import.defer()` validation (v1.0.19)

The pinned Test262 script-goal rejection cases call `import.defer()` to verify
that abrupt specifier coercion rejects the returned Promise with the **same
thrown value**. Node 24/26 `vm.Script` cannot parse that phase-qualified form,
even though esm-sync already transforms it and implements the deferred runtime.
Previously, the wrapper executed the raw source under Node and misreported a
native syntax error as a Test262 runtime failure.

For scripts whose source contains a real `import.defer()` call, the private
runner compiles the source using esm-sync's script grammar and executes the
result through `vm.Script` with esm-sync's existing runtime bound to that
script's filename. It retains the **script goal**, including global `var`
bindings, and does not convert scripts into modules or CommonJS wrappers.
Only actual deferred-call transformations take this path: comments and string
literals containing `import.defer(` leave the original script untouched.
Test262 completion and Promise assertions still run normally. The pinned 16
specifier-rejection cases are covered by a required positive conformance
regression rather than a skip or syntax-only classification. A separate
regression links a real deferred dependency and verifies that its body runs
only upon namespace access.

The full pinned Node 26.12.0 run selects 1,745 cases: **1,471 pass, 265 fail,
9 unsupported, 0 excluded**. Compared with v1.0.18 this restores the 16
rejection cases and two generated `with`-expression assertions, with **zero
regressions**. The remaining failures are 15 dynamic-import cases (including
five `syntax/valid` assertions, four deferred async graphs, three `for await`
cases, and three other runtime cases), nine deferred imports, and 241
`top-level-await` cases. Async module graphs and ModuleSource support remain
out of scope.

### Remaining runtime conformance investigation (v1.0.20)

The complete pinned v1.0.19 report on Linux / Node 26.12.0 still has **265
failures**, nine independently reported unsupported cases, and no exclusions.
The remaining failures do **not** all indicate incomplete synchronous import
linking:

| Test262 area | Failures | Observed constraint |
| --- | ---: | --- |
| `module-code/top-level-await` | 241 | Async module evaluation is outside the synchronous loader's scope. |
| `import/import-defer` | 9 | Eight tests explicitly require async module graphs; `deferred-namespace-object/identity.js` also contains a top-level `await import.defer(...)`. |
| `expressions/dynamic-import` / deferred async dependencies or errored async cycle | 5 | Require top-level await in imported modules or async-cycle evaluation. |
| `expressions/dynamic-import` / `for-await-resolution-and-error*` | 3 | Pass unchanged on Node 24.21.0; fail under the Node 26.12.0 Test262 `vm.Script`/native dynamic-import execution path. |
| `expressions/dynamic-import` / script grammar and `syntax/valid` runtime cases | 6 | An unobserved runtime import in `assignment-expression/unary-expr.js`, and five observable `with`/constructor tests. Native resolution of deliberately invalid specifiers causes rejected promises. |
| `expressions/dynamic-import` / `import-attributes/2nd-param-with-type-text.js` | 1 | Host text-module support is required; the Node 26 run throws `TypeError`. |

The Test262 deferred namespace identity case is **not** a synchronous identity
regression: the source contains top-level `await`. A separate required
phase-validation regression checks the equivalent synchronous graph without
that dependency: repeated static imports, an import through a different
module, and `import.defer()` all share one deferred namespace, distinct from
the ordinary eager namespace. This passes on Node 24.21.0 and Node 26.12.0,
and keeps the actual Test262 case active and failing as before.

The three `for await` failures are reproducible on Node 26 and their stderr
starts at `node:internal/modules/esm/module_job:702` (`evaluateSync`). The
same pinned files, wrapper, and esm-sync build pass on Node 24. Replacing
native script `import()` with esm-sync's dynamic-import runtime was tested
locally but **did not** preserve all the cases' error/assertion behaviour, so
that broad harness replacement was discarded. A Node 26 host-loader or
harness interaction remains to investigate; neither an esm-sync root cause
nor a safe fix has been established. No assertions, error checks, or
unhandled-rejection handling were relaxed.

The five `syntax/valid` failures with runtime assertions must **not** be
reclassified as grammar-only merely because their filenames contain
`syntax/valid`: their `with` and constructor expressions inspect actual
Promise objects. Similarly, ignoring unhandled rejections would hide runtime
failures. ModuleSource and text-import host support are not added by this
patch. All 1,745 selected cases continue to be reported, with no new skip or
unsupported classifications. This investigation adds a synchronous identity
regression and documentation only; it does not claim a higher Test262 pass
count or change production loader behaviour.

### Outstanding synchronous script-import rejections (v1.0.22 audit)

The six remaining synchronous script-goal dynamic-import cases contain a
runtime `import()` that can reject without a corresponding rejection handler:
`assignment-expression/unary-expr.js`,
`syntax/valid/new-covered-expression-is-valid.js`, and four
`syntax/valid/nested-with-expression-*` cases. Five execute genuine
`assert.sameValue` or `assert.throws` checks and must **not** be treated as
parse-only cases.

On Node 26.12.0 all six run successfully with the host's unhandled-rejection
reporting disabled, but fail with its default fatal unhandled-rejection policy
(`ERR_MODULE_NOT_FOUND`). This diagnostic establishes the difference between
synchronous assertions and later host rejection reporting; it does **not**
justify disabling that policy in the Test262 runner. Doing so would also hide
unrelated rejected promises and potentially turn runtime bugs into false
passes. The six cases remain executable and failing until a precise host
rejection-tracking strategy can distinguish unrelated errors.

### Native ESM rejection diagnostics (v1.0.23 investigation)

The three Node 26 `for-await-resolution-and-error*` failures are not caused
by esm-sync's static linker, Test262's `_FIXTURE.js` format hook, or even its
`vm.Script` loader. On the supplied Node 26.12.0 runtime, the independent
native expression `import('data:text/javascript,throw%20%27foo%27').catch(...)`
prints a partial `node:internal/modules/esm/module_job` `evaluateSync()`
stack to stderr **despite the rejection being caught and the process exiting
successfully**. The same native expression completes with empty stderr on
Node 24.21.0. The original tests also complete their `$DONE` assertions but
fail the runner's strict unexpected-stderr check. Suppressing engine stderr or
switching a throwing module to CommonJS would mask errors or change module
semantics; neither is an acceptable conformance fix.

For the other six cases, `async_hooks` can expose the original rejected
`import()` Promise on the tested Node version. However, identifying that
Promise by its captured JavaScript stack is not a stable host API, and
ignoring all native-import rejections would also conceal unexpected module
errors. The runner therefore retains fatal unhandled-rejection behaviour.
Focused regressions explicitly check that an unrelated rejected Promise
**with the same `ERR_MODULE_NOT_FOUND` code** and an unrelated asynchronous
exception still fail ordinary synchronous Test262 scripts. No case is
reclassified, excluded, or counted as passing by this investigation.

### Synchronous native import Promise attribution (v1.0.24)

The six script-goal tests identified in v1.0.22 now execute and pass without
suppressing unrelated unhandled rejections or reclassifying executable tests.
For **positive, synchronous scripts only**, the private runner first compiles
the original source using `vm.Script` to preserve native syntax validation.
It then uses Acorn to locate genuine `import()` expressions and
`import.source()` calls, wrapping each expression in a test-only observer.
The source-phase forms are represented by equal-length substitutions in the
**analysis copy**, never in the executed code. If Acorn cannot handle a newer
valid host grammar, the runner executes the original script unchanged.

The observer returns the **same native Promise** without calling `then()` or
`catch()`, and remembers that exact object in a `WeakSet`. An
`unhandledRejection` listener ignores only a rejection from a Promise in
that set; all other rejections still throw, including a separate Promise
rejected with the **identical Error object**, a derived Promise created by
`.then()`, and a method merely named `import` or `import.source`.
Asynchronous tests, negative-phase tests, generated parse-only cases,
module-goal tests, and scripts transformed for `import.defer()` retain their
existing execution paths. The native dynamic-import loader and runtime
assertions are unchanged. This is a harness-only host-completion adjustment,
not a change to esm-sync's implementation of dynamic imports.

The complete pinned corpus on Linux Node 26.12.0 reports **1,477 passed,
258 failed, 10 unsupported, and 0 excluded**. A per-case comparison with
the v1.0.21 report shows exactly six failure-to-pass changes and no new
failures. The remaining failures are 241 top-level-await tests, nine
async-dependent deferred-import tests, and eight dynamic-import tests
(including three Node 26 native VM diagnostics). The six covered cases are
all executed, not treated as parse-only or unsupported.

### Native text-import host capability (v1.0.21)

The pinned `expressions/dynamic-import/import-attributes/2nd-param-with-type-text.js`
case now runs its import through esm-sync, while retaining Script-goal execution
in `vm.Script`. It passes without experimental native text-import support, as do
the five static module-goal text-import cases. The selector no longer treats
native `import-text` support as a requirement for either source goal.

All script import calls use the loader's existing compiler and runtime. This
also avoids Node/V8's fatal native evaluation path for a fulfilled member of an
errored async cycle. The required regression still checks that the later import
rejects with the exact original error. Promise tracking handles those compiled
calls without replacing their returned Promises or suppressing unrelated
rejections. See [async module loading](async-module-loading.md) for the current
deferred-import, resource-management, and completion-order guarantees.

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
