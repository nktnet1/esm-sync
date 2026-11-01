# Compatibility review of the exported issues

Review date: 2 November 2026. Baseline: the v1.0.19 source and canonical production
loader. Every one of the **83 issue bodies and 282 exported comments** in the
supplied `issues.json` was reviewed, including the **22 reports previously marked
not planned**. The export's SHA-256 is
`73a278df18bda582b3eedbd318d43e4b0fe2fe58193ebddcdfe3b938beece151`.

There is useful work remaining. **Reopen the recovered dynamic-import report,
then implement private package imports and modern import metadata.** The first
is an actual outstanding report. The latter two are adjacent modern Node gaps
found while checking claims of package/ESM compatibility. They are not failures
of the already repaired public `exports` examples.

This is an audit and a work queue. Runtime fixes are not included. The detailed
ledger below distinguishes an existing mechanism test, a scoped host result,
a missing feature, and an application that has not been reproduced. An
already-covered label does not certify every historical application in its
comments.

## Recommended work order

| Priority | Work | Evidence now | Completion criterion |
| --- | --- | --- | --- |
| 1 | Repair the recovered dynamic-import path | Original utility source and tests from historical Dyo Git history pass natively and fail with the loader on Node 22/24/26. Both Mocha launch paths fail in every cache configuration | Preserve the exact source/tests, add a bounded permanent regression, and get both tests passing through the production loader without adding a static import or changing globals in the fixture |
| 2 | Implement `package.json` private `imports` mappings | Native static/dynamic `#value` imports succeed. The preloaded fork throws `Cannot find module '#value'` in disabled/cold/warm runs on all three Node versions. Ordinary native require remains a successful control | Resolve from the importer's package scope with import/require conditions kept separate. Cover exact/pattern/external-package targets, null blocking, invalid targets, package boundaries, self references, missing targets, custom conditions, and cache order |
| 3 | Implement the modern `import.meta` helpers | Native Node supplies `resolve`, `dirname`, `filename`, and `main`. All four are absent from the fork's metadata in the same process matrix. `url` is present | Match native results for file modules, dependency versus main entry, encoded paths/symlinks, package exports/private imports, nonexistent relative targets, and builtins. Do not implement `resolve` as require.resolve, which can choose the wrong condition |
| 4 | Execute a newer Jest version matrix | Installed Jest 26 has actual transform/VM/protobuf scenarios. The newer API shape only has a contract test | Run real supported newer Jest majors with cold/warm transforms, configured globals, mocks/resets, shared imports, coverage, and dependency transforms. Retain the legacy runner where existing scenarios depend on it |
| 5 | Reconsider strict `.mjs` mocking through an explicit API | Current behavior is verified: a `.js` importer sees a CJS hook's mock while a `.mjs` importer sees the real export | Design scoped injection/reset behavior with live bindings, cycles, cached rejection, and no cross-test leakage. Keep current strict defaults until an explicit compatibility mode/API is specified |
| 6 | Add focused integration examples and tests | Registered YAML re-exports, initialized globals, library-owned loaders, multiple handler entries, and resolve-dir REPL loading work in fresh probes | Retain those cases as permanent regressions. Add actual PM2 cluster and Lerna-streaming checks, plus examples of library/default-export ownership and per-handler bootstraps |

The best next patch is priority 1. Priorities 2 and 3 provide broad compatibility
with modern packages without changing native script grammar or adding browser
runtime emulation. Private import resolution should precede, or be developed
alongside, `import.meta.resolve` so the two APIs agree.

## Recovered dynamic-import investigation

Upstream report: [https://github.com/standard-things/esm/issues/829](https://github.com/standard-things/esm/issues/829).

The old `hooks` ref no longer resolves, but Git history retains the files at
commit `007ba068eb81ebbb7d2e48731d4a6ce230023dc1`, dated 16 July 2019. The recovered
utility tests dynamically import query-distinct copies of a module while
checking iterator fallbacks and deferred polyfill initialization. Their setup
temporarily replaces Symbol, Promise, and timer globals.

Sources read:

- [https://github.com/dyo/dyo/blob/007ba068eb81ebbb7d2e48731d4a6ce230023dc1/test/Utility.js](https://github.com/dyo/dyo/blob/007ba068eb81ebbb7d2e48731d4a6ce230023dc1/test/Utility.js)
- [https://github.com/dyo/dyo/blob/007ba068eb81ebbb7d2e48731d4a6ce230023dc1/src/Utility.js](https://github.com/dyo/dyo/blob/007ba068eb81ebbb7d2e48731d4a6ce230023dc1/src/Utility.js)

| Artifact | SHA-256 |
| --- | --- |
| Original `src/Utility.js` | `e6d8ae74678d6c2de9800d4eda059ebca126f4bae17113eb9762c2f19dca32d1` |
| Original `test/Utility.js` | `d99fff6a6ef56367724f7fa7dea13ced41dbfb276eea9e9c61aa8a8b3e7e36e6` |

The two source files were copied byte-for-byte. The fixture uses the installed
Mocha **8.4.0** and a small CommonJS setup exposing Node's assertion API. The
original project used Mocha 6.1.4, Chai 4.2.0, and jsdom 15.1.1. Its full DOM
setup and full project suite were not executed. This is a verified original
utility-mechanism regression on current Node, not certification of the entire
historical project/environment. Cache configuration was varied around the
unchanged source/test files.

| Launch | Result on Node 22.23.4 / 24.21.0 / 26.12.0, disabled/cold/warm |
| --- | --- |
| Native Node + Mocha CLI | Both tests pass |
| Node preload + Mocha CLI | Both tests fail with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` |
| Node preload + explicit synchronous Mocha file loading | Both tests fail with the same error |

The failure happens at each test's dynamic import expression. Ordinary reduced
imports, nested async imports, query imports, and simple global-replacement
controls all succeed. Therefore **do not claim that query strings or replacing
Promise alone is the root cause**. Trace the test module's compilation/loading
path before selecting the fix. Candidate areas are
[`module/proto/compile.ts`](../src/module/proto/compile.ts),
[`module/internal/compile.ts`](../src/module/internal/compile.ts), and
[`runtime.ts`](../src/runtime.ts).

The error means a native VM import path ran without an import callback. Node's
VM documentation describes that contract, but it does not establish which
fork path lost the transformation/callback in this case:
[https://nodejs.org/api/vm.html#support-of-dynamic-import-in-compilation-apis](https://nodejs.org/api/vm.html#support-of-dynamic-import-in-compilation-apis).
The fix should not globally enable static imports in arbitrary VM scripts.

## Native package and metadata gaps

These are additional follow-ups related to the public-package-resolution and
migration reports. Do not count them as two extra historical reports or claim
the repaired public `exports` cases have regressed.

For a package with this mapping:

```json
{
  "type": "module",
  "imports": {
    "#value": {
      "import": "./import.mjs",
      "require": "./require.cjs"
    }
  }
}
```

`import value from '#value'` and `import('#value')` work natively but fail through
the fork in the measured matrix. `require('#value')` selects the require target
successfully as a control. The import and require branches must stay distinct.
The current fallback to CommonJS resolution is not an implementation of the
package-imports algorithm. Node also allows private imports to target external
packages, unlike public exports:
[https://nodejs.org/api/packages.html#subpath-imports](https://nodejs.org/api/packages.html#subpath-imports).

The fork's [`runtime.ts`](../src/runtime.ts) currently creates metadata with
`url` only. In a real `.mjs` main entry, this probe demonstrates the difference:

```js
console.log({
  resolve: typeof import.meta.resolve,
  dirname: typeof import.meta.dirname,
  filename: typeof import.meta.filename,
  main: import.meta.main
})
```

Native results are `function`, `string`, `string`, and `true`. Fork results are
four `undefined` values. The missing `main` value can silently prevent CLI
startup, while missing path/resolve helpers can break current dependencies.
Implement the documented file-URL and entry-point meanings, and make the
resolver return URLs without evaluating target modules:
[https://nodejs.org/api/esm.html#importmeta](https://nodejs.org/api/esm.html#importmeta).

## What works already and needs retained evidence

The new production-loader probes pass on Node **22.23.4**, **24.21.0**, and
**26.12.0**, each in disabled/cold/warm configurations:

| Case | Observed result | Limit |
| --- | --- | --- |
| Actual resolve-dir 1.0.1 in an interactive `node -i` REPL | Loads promptly, resolves a plain path and the home directory | Does not certify every historical findup/global-prefix version |
| js-yaml 4.3.2 registered before the loader, with the reported `.js` YAML re-export shape | Correct parsed value, one YAML load | Registration is required. The strict `.mjs` control still rejects YAML |
| Application-owned `Parse`-shaped global initialized in a preload | Imported module sees the initialized value | Not an actual Parse Server/PM2 application run |
| Library owns a nested esm-sync dependency and exports its default class explicitly | Native CJS consumer constructs and uses the class | Original private registry package was not fetched |
| Two independent CJS handler bootstraps share ESM helpers | Both return their distinct expected results | Portable serverless pattern, not a run in Azure Functions v2 |
| CJS mock hooks with `.js` versus `.mjs` importers | `.js` sees the stub, strict `.mjs` sees the real value | Confirms the intentional current mocking boundary, not newly implemented `.mjs` mocking |

These are **54 passing supported-behavior/boundary checks**. The six checks per
configuration group the library/handler patterns into one process. Register
hooks and bootstraps improve compatibility without embedding every data parser
or process manager in the production package.

## Further coverage worth adding

- **PM2 and streamed diagnostics:** Existing PM2 scenarios exercise fork
  startup. Add a disposable cluster-mode ecosystem case with an application
  cwd different from PM2's home and a package-local preload path. For Lerna,
  assert a missing-import diagnostic reaches the parent's drained stderr and
  preserves the failing exit status. Neither target's full new scenario ran
  in this review.
- **Packaged/virtual filesystems:** Current safe prototypes retain inherited
  Stats methods. A normal fs test is not a pkg executable or packaged ASAR
  test. Add an actual supported packaging target before promising that scope.
- **Multi-package shared realms:** Repeated factory initialization is covered,
  but two independent Atom-like packages in one renderer is a stronger case
  than initializing the same factory twice.
- **Broader Jest and mocking:** Current real integrations use Jest 26. A
  contract test for modern `process`/`getCacheKey` signatures does not execute a
  newer Jest runner. Jest documents independent transform and mock-hoisting
  behavior, so test the actual supported combinations:
  [https://jestjs.io/docs/code-transformation](https://jestjs.io/docs/code-transformation).
- **Reload and precompile APIs:** An explicit graph-isolated reload API could
  help file watchers. A documented compile/build API could help offline
  packaging and startup. Both need a designed registry/output contract.
  `cache:false` should continue to mean compiler-cache control, rather than
  implicit re-execution of imported side effects.

## Boundaries to retain

A browser/React Native runtime does not supply this loader's Node filesystem and
module host. Selecting the actual application as a bundler entry is the right
fix for the webpack-stream report. Standard decorators, TypeScript legacy and
parameter decorators, and a runtime module loader are different layers. Verify
registered transforms rather than silently add an unrelated transpiler.

HTTP imports would require a deliberate asynchronous network loader and cache
contract. They are a possible separate feature, but are lower priority than the
local failures reproduced here. Arbitrary native VM scripts should keep their
script semantics. Strict `.mjs` mocking/YAML support should require an explicit
design rather than a hidden global CommonJS hook.

Keep existing host resolution scope: the pinned Electron/VS Code checks and
real WebContainer reconstruction passed in earlier supplied runs. The native
USB repair belongs to the affected native dependency/build. It is not an
automatic repair performed by installing esm-sync. The deleted original
renderer reproduction is not required by the user-approved renderer criterion.

## Validation and scope

Canonical production loader SHA-256:
`08848202b61eb621a08de03aea5f73201f34267c1621200f2c6c213994c8267a`.
No runtime source or loader bytes changed during this review.

- **222 existing tests in nine files pass** on Linux/Node 24.21.0 against the
  production build: upstream regressions, module mocking, package exports,
  observable compatibility, Reflect polyfills, REPL/eval hooks, host modules,
  and package configuration.
- **54 new supported-behavior/boundary checks pass** across the three Node
  versions and three cache configurations described above.
- **36 native/fork comparison pairs** cover static private imports, dynamic
  private imports, ordinary require, and import metadata on the same matrix.
  They establish the two modern compatibility gaps, not passing support for
  those features.
- **27 recovered-utility launches** cover native CLI, preloaded CLI, and
  preloaded synchronous Mocha on that matrix. Nine native launches pass.
  Eighteen loader launches fail and remain open evidence, not accepted skips.
- Every exported report appears exactly once in the ledger, and every local
  evidence link in it resolves. The attached export itself was not modified.

This does not rerun the full runtime/conformance/OS matrix, Docker GUI hosts,
actual WebContainers, PM2 cluster, Lerna, pkg, or deployed services. Those are
separate validations where stated. The audit fixes roadmap accuracy and records
reproductions. It does not resolve the newly identified defects.

## Complete issue ledger

The previous label is preserved here for traceability. The accompanying roadmap
moves the recovered utility report into investigation and resolve-dir into
covered for the tested current REPL. Other review recommendations do not turn
unverified hosts or proposed features into confirmed fixes.

### Previously not planned

| Report | Review assessment | Recommended work and evidence |
| --- | --- | --- |
| unable to run npm install. [https://github.com/standard-things/esm/issues/930](https://github.com/standard-things/esm/issues/930) | **External** | The failure is the upstream checkout's obsolete sleep/NAN development addon on macOS ARM64. This fork declares no sleep dependency. Keep installed-package/build checks, but do not repair third-party NAN in the loader or claim a fresh macOS ARM64 install was tested here. Evidence: [package.json](../package.json). |
| ESM decorators availability. [https://github.com/standard-things/esm/issues/929](https://github.com/standard-things/esm/issues/929) | **Feature** | Distinguish TypeScript legacy/parameter decorators from standard decorator syntax. Prefer testing registered TypeScript/Babel transforms and metadata interoperability. A module loader should not silently become a decorator transpiler. Evidence: [src/parser.ts](../src/parser.ts), [test/vitest/reflect-polyfills.test.ts](../test/vitest/reflect-polyfills.test.ts). |
| What should I pay attention to when configuring esm?. [https://github.com/standard-things/esm/issues/928](https://github.com/standard-things/esm/issues/928) | **Usage** | A correctly initialized application global is visible across imports in the new probes. Document initialization before loading the dependent graph. A static import can run before a nearby assignment. The actual Parse Server/PM2 application remains unverified. Evidence: [src/visitor/undeclared.ts](../src/visitor/undeclared.ts), [docs/MAINTAINER_GUIDE.md](../docs/MAINTAINER_GUIDE.md). |
| Getting weird ESM error - goes away if I delete yarn.lock. [https://github.com/standard-things/esm/issues/927](https://github.com/standard-things/esm/issues/927) | **External** | The Appium installation invokes native Node without this loader. Lockfile changes select different dependencies. An installed runtime cannot repair an unrelated package-manager lifecycle before it is loaded. Evidence: [docs/interop-and-migration.md](../docs/interop-and-migration.md). |
| Error while importing ES Module in commonjs via Dynamic import. [https://github.com/standard-things/esm/issues/920](https://github.com/standard-things/esm/issues/920) | **Usage** | The sample uses native dynamic import and extensionless relative imports inside .mjs, with no esm installation shown. Document complete output extensions or explicit fork use. Do not weaken strict .mjs resolution by default. Evidence: [docs/interop-and-migration.md](../docs/interop-and-migration.md), [src/module/esm/resolve-filename.ts](../src/module/esm/resolve-filename.ts). |
| Is this repo still alive?. [https://github.com/standard-things/esm/issues/919](https://github.com/standard-things/esm/issues/919) | **External** | Upstream maintenance discussion has no independent runtime defect. This fork's release and compatibility documentation address its own maintenance scope. Evidence: [docs/MAINTAINER_GUIDE.md](../docs/MAINTAINER_GUIDE.md). |
| Código parou de Rodar. [https://github.com/standard-things/esm/issues/907](https://github.com/standard-things/esm/issues/907) | **External** | The linked crawler question has no loader failure, version, or failing module trace in the export. A concrete current reproduction is needed before proposing a runtime patch. Evidence: [docs/FORK_ISSUES_ROADMAP.md](../docs/FORK_ISSUES_ROADMAP.md). |
| Problems when using in a monorepo with Lerna. [https://github.com/standard-things/esm/issues/903](https://github.com/standard-things/esm/issues/903) | **Investigate** | Missing-import diagnostics under Lerna streaming are worth a pinned integration test. Direct Node error tests do not prove parent-process output draining or aggregation. No Lerna-specific failure was reproduced in this review. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts), [src/error/mask-stack-trace.ts](../src/error/mask-stack-trace.ts). |
| A Fix to A Breaking Issue is Being Ignored (and Has Been For Months). [https://github.com/standard-things/esm/issues/893](https://github.com/standard-things/esm/issues/893) | **External** | The maintenance complaint refers to the optional-chaining fix, which this fork already has. Track the parser regression under the actual syntax reports, rather than create a new runtime task for governance. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Loading .yaml file doesn't work. [https://github.com/standard-things/esm/issues/892](https://github.com/standard-things/esm/issues/892) | **Usage** | The error is Node's syntax-checking path on a .yaml argument, and the displayed project has no esm dependency. Document the command/argument distinction and custom loader boundary. Built-in YAML parsing would not repair that native check command. Evidence: [src/hook/process.ts](../src/hook/process.ts), [docs/interop-and-migration.md](../docs/interop-and-migration.md). |
| Failed building JavaScript bundle. Unable to resolve "module" from "node_modules/esm/esm.js". [https://github.com/standard-things/esm/issues/890](https://github.com/standard-things/esm/issues/890) | **External** | React Native lacks the required Node module/filesystem runtime. Bundle the actual application module rather than this Node loader. General React Native support is a different product. Evidence: [package.json](../package.json). |
| import url via http or https expected per esm spec, but crashes. [https://github.com/standard-things/esm/issues/884](https://github.com/standard-things/esm/issues/884) | **Feature** | Remote HTTP imports need an asynchronous fetch/resolution/cache design and Node-loader integration. Leave synchronous network require unsupported. Consider only as a deliberate separate async feature, not an incidental protocol-error workaround. Evidence: [src/module/esm/resolve-filename.ts](../src/module/esm/resolve-filename.ts). |
| How can I use this with Azure Functions v2? (serverless functions). [https://github.com/standard-things/esm/issues/869](https://github.com/standard-things/esm/issues/869) | **Usage** | Two independent CommonJS handler wrappers can load shared ESM helpers today. The new probes verify that portable pattern. Add a serverless example rather than require a single global application entry. Actual Azure Functions v2/Node 8/10 is not certified by these checks. Evidence: [src/index.ts](../src/index.ts), [docs/interop-and-migration.md](../docs/interop-and-migration.md). |
| Error on private npm class. [https://github.com/standard-things/esm/issues/862](https://github.com/standard-things/esm/issues/862) | **Usage** | The new installed-layout reconstruction works when the library owns its loader dependency and exports the class value explicitly. Document that pattern and .default. The original private registry package/gist was not rerun, so this is not blanket certification of it. Evidence: [docs/interop-and-migration.md](../docs/interop-and-migration.md), [package.json](../package.json). |
| Error with pm2: Cannot find module 'esm'. [https://github.com/standard-things/esm/issues/861](https://github.com/standard-things/esm/issues/861) | **Usage** | Cannot find the preload package occurs before its runtime can run. Existing PM2 tests use fork startup paths. Add isolated cluster-mode and cwd/preload-path tests plus a robust ecosystem example. Do not fix this by copying dependencies into a user's home directory. Evidence: [test/harness/scenario-tests.ts](../test/harness/scenario-tests.ts), [test/harness/pm2-environment.ts](../test/harness/pm2-environment.ts). |
| ESM API?. [https://github.com/standard-things/esm/issues/859](https://github.com/standard-things/esm/issues/859) | **Feature** | A build/compile API could reduce runtime work, but needs stable output/runtime/linking/source-map/version contracts. It is not currently public. Design separately after the concrete runtime gaps. Evidence: [src/compiler.ts](../src/compiler.ts), [src/runtime.ts](../src/runtime.ts). |
| Can I deploy on heroku?. [https://github.com/standard-things/esm/issues/845](https://github.com/standard-things/esm/issues/845) | **Usage** | The report gives a local nodemon preload but no production launch configuration. Provide a platform-neutral production preload/bootstrap example and dependency-placement checks. Actual Heroku deployment is unverified. Evidence: [docs/interop-and-migration.md](../docs/interop-and-migration.md), [package.json](../package.json). |
| ReferenceError: Invalid left-hand side expression in prefix operation. [https://github.com/standard-things/esm/issues/833](https://github.com/standard-things/esm/issues/833) | **Usage** | Actual js-yaml registration plus the reported .js re-export shape succeeds in the new probes. Strict .mjs still rejects YAML. Add hook setup documentation/regressions instead of adding an implicit YAML parser or treating YAML as JavaScript. Evidence: [src/module/esm/loader.ts](../src/module/esm/loader.ts), [test/harness/file-extension-tests.ts](../test/harness/file-extension-tests.ts). |
| Error: Not supported. [https://github.com/standard-things/esm/issues/829](https://github.com/standard-things/esm/issues/829) | **Investigate** | Reopen. Recovered historical utility source/tests expose ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING under the current loader, while native Node passes. Both CLI and synchronous Mocha launches fail. Add a permanent original-mechanism regression and fix the lost dynamic-import path before claiming resolution. Evidence: [src/module/proto/compile.ts](../src/module/proto/compile.ts), [src/module/internal/compile.ts](../src/module/internal/compile.ts), [src/runtime.ts](../src/runtime.ts). |
| esm using gulp 4 webpack-stream setup not working. [https://github.com/standard-things/esm/issues/828](https://github.com/standard-things/esm/issues/828) | **External** | The author fixed the webpack-stream entry to the application module. Bundling the runtime Node loader into a browser entry is not a loader compatibility defect. Evidence: [package.json](../package.json). |
| Problems loading 'resolve-dir'. [https://github.com/standard-things/esm/issues/791](https://github.com/standard-things/esm/issues/791) | **Covered** | Reclassify from not planned to covered on the tested modern Node versions. Actual resolve-dir 1.0.1 loads and resolves a home path in the interactive REPL in all three cache modes. Add a permanent focused regression to retain that evidence. Evidence: [test/vitest/repl-hook.test.ts](../test/vitest/repl-hook.test.ts). |
| Interoperability with pkg. [https://github.com/standard-things/esm/issues/780](https://github.com/standard-things/esm/issues/780) | **Investigate** | The historical pkg/Stats virtual-filesystem integration merits a pinned packaged-runtime test only if that target matters. Safe prototype handling is improved, but no actual pkg executable was built here. Do not mark the original packaging issue fixed from a normal Node fs test. Evidence: [src/util/safe.ts](../src/util/safe.ts), [src/fs/stat-sync.ts](../src/fs/stat-sync.ts), [src/fs/stat-fast.ts](../src/fs/stat-fast.ts). |

### Previously already covered

| Report | Review assessment | Recommended work and evidence |
| --- | --- | --- |
| esm crashes. [https://github.com/standard-things/esm/issues/931](https://github.com/standard-things/esm/issues/931) | **Covered** | Native filesystem ABI regression has a dedicated Node subprocess case. Keep the Node-version matrix when changing fast filesystem paths. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Connot compile optional chaining when the word eval is present inside the file.. [https://github.com/standard-things/esm/issues/926](https://github.com/standard-things/esm/issues/926) | **Covered** | Optional chaining with eval inside comments or strings has an explicit regression. No new feature is needed for the reported syntax. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| `exports` field in package.json is ignored. [https://github.com/standard-things/esm/issues/924](https://github.com/standard-things/esm/issues/924) | **Covered** | Public exports and remotion/version are covered. A separate, newly confirmed gap is package-private imports mappings. Implement that next without relabeling the repaired exports case as broken. Evidence: [test/vitest/package-exports.test.ts](../test/vitest/package-exports.test.ts), [src/module/esm/resolve-filename.ts](../src/module/esm/resolve-filename.ts). |
| Using esm to import esm synchronously.. [https://github.com/standard-things/esm/issues/922](https://github.com/standard-things/esm/issues/922) | **Usage** | Synchronous loading through a CommonJS facade/factory is supported. Add a clear native-ESM createRequire example. The report's module variable is not a native ESM binding, and createRequire alone does not install the fork. Evidence: [docs/interop-and-migration.md](../docs/interop-and-migration.md), [test/vitest/package-exports.test.ts](../test/vitest/package-exports.test.ts). |
| Code is executed in require. [https://github.com/standard-things/esm/issues/921](https://github.com/standard-things/esm/issues/921) | **Covered** | The function body must parse even when the function is not called. Tests cover modern syntax without invoking the exported function. No change to eager dependency evaluation is appropriate. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Add support for conditional chaining. [https://github.com/standard-things/esm/issues/918](https://github.com/standard-things/esm/issues/918) | **Covered** | Optional chaining is covered by current parser and execution regressions, including missing/computed properties. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Breaks stackblitz. [https://github.com/standard-things/esm/issues/917](https://github.com/standard-things/esm/issues/917) | **Scoped** | The shared-VM corruption failure and reconstructed consumer passed actual WebContainer verification supplied earlier. The historical complete Ember dependency graph is still unverified. Preserve that distinction and shared-global descriptors. Evidence: [docs/host-integrations.md](../docs/host-integrations.md), [test/vitest/webcontainer.test.ts](../test/vitest/webcontainer.test.ts). |
| fs.watch  load file has cache. [https://github.com/standard-things/esm/issues/916](https://github.com/standard-things/esm/issues/916) | **Scoped** | cache:false controls compiled output, not an evaluated module registry. Fresh processes/workers are supported. Graph-aware reload could be a separate explicit feature, but automatic re-evaluation would violate normal module caching. Evidence: [test/vitest/module-mocking.test.ts](../test/vitest/module-mocking.test.ts), [docs/MAINTAINER_GUIDE.md](../docs/MAINTAINER_GUIDE.md). |
| Load ES module from VS Code extension. [https://github.com/standard-things/esm/issues/915](https://github.com/standard-things/esm/issues/915) | **Scoped** | Original pinned Linux VS Code extension activation, command, and port checks pass. Extend host versions only with actual host runs. UI Reload Window is not part of the current automation. Evidence: [docs/host-integrations.md](../docs/host-integrations.md), [test/vitest/host-modules.test.ts](../test/vitest/host-modules.test.ts). |
| On GitHub Actions, prints path to …/node_modules/esm/esm.js:1 and lots of code. [https://github.com/standard-things/esm/issues/914](https://github.com/standard-things/esm/issues/914) | **Covered** | Bundled-source error walls have direct regressions. Lerna's streamed-output path in another report remains a useful separate integration test. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Possibility to use esm in worker threads or threads.js. [https://github.com/standard-things/esm/issues/913](https://github.com/standard-things/esm/issues/913) | **Scoped** | Worker file/eval loading and async worker imports have coverage. Synchronous worker I/O awaits remain an explicit bridge limitation. Add a pinned threads.js scenario only if supporting that wrapper, rather than claiming it from Worker tests. Evidence: [test/harness/misc-tests.ts](../test/harness/misc-tests.ts), [test/vitest/async-contexts.test.ts](../test/vitest/async-contexts.test.ts). |
| nyc issues and workarounds. [https://github.com/standard-things/esm/issues/910](https://github.com/standard-things/esm/issues/910) | **Covered** | Real NYC instrumentation after normal warm-cache startup is covered. Cache disable behavior and coverage namespaces are explicit. Evidence: [test/vitest/coverage-cache.test.ts](../test/vitest/coverage-cache.test.ts), [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Nullish coalescing (`??`) causes `SyntaxError`. [https://github.com/standard-things/esm/issues/909](https://github.com/standard-things/esm/issues/909) | **Covered** | Nullish coalescing in an actual import graph has execution regressions. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Error [ERR_INVALID_PROTOCOL]: Protocol 'node:' not supported. Expected 'file:'. [https://github.com/standard-things/esm/issues/904](https://github.com/standard-things/esm/issues/904) | **Covered** | node: builtin imports are supported and exercised throughout the runtime/host tests. Modern import.meta helpers are a separate compatibility gap found in this review. Evidence: [test/vitest/builtin-modules.test.ts](../test/vitest/builtin-modules.test.ts), [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Error [ERR_REQUIRE_ESM]: Must use import to load ES Module: code: 'ERR_REQUIRE_ESM'. [https://github.com/standard-things/esm/issues/900](https://github.com/standard-things/esm/issues/900) | **Scoped** | The type:module mechanism is covered, and separate Electron regressions pass. The particular packaged WhatApp/ASAR/Babel graph was not run. An ASAR packaged-app fixture would improve evidence. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts), [docs/host-integrations.md](../docs/host-integrations.md). |
| Node v12: Readme example adapted to is-fn fails with ERR_REQUIRE_ESM. [https://github.com/standard-things/esm/issues/898](https://github.com/standard-things/esm/issues/898) | **Covered** | A type:module package loaded from CommonJS is covered. Retain extension and package-scope tests rather than remove type:module from consumers. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| ERR_REQUIRE_ESM: The simplest fix!. [https://github.com/standard-things/esm/issues/897](https://github.com/standard-things/esm/issues/897) | **Covered** | This points to a fork for the same type:module regression. The mechanism is already covered here. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| `esm/loader.js` logs to terminal on any error. [https://github.com/standard-things/esm/issues/896](https://github.com/standard-things/esm/issues/896) | **Covered** | Uncaught application errors no longer need to print the bundled loader. Direct thrown-error regressions cover this mechanism. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Where is the documentation?. [https://github.com/standard-things/esm/issues/888](https://github.com/standard-things/esm/issues/888) | **Usage** | Factory usage is documented, but Jasmine-specific preload/bootstrap examples would prevent the same setup confusion. Runtime Jasmine scenarios already exist. Evidence: [docs/interop-and-migration.md](../docs/interop-and-migration.md), [test/harness/scenario-tests.ts](../test/harness/scenario-tests.ts). |
| Not working with Jasmine. [https://github.com/standard-things/esm/issues/887](https://github.com/standard-things/esm/issues/887) | **Scoped** | The report's comments identify Jasmine version/configuration differences. Keep the installed runner scenarios and document the Node preload entry. Do not claim every historical helper-path setup is interchangeable. Evidence: [test/harness/scenario-tests.ts](../test/harness/scenario-tests.ts), [docs/interop-and-migration.md](../docs/interop-and-migration.md). |
| Not working with code run by `vm.runInThisContext`. [https://github.com/standard-things/esm/issues/886](https://github.com/standard-things/esm/issues/886) | **Scoped** | The original global REPL shortcut is resolved by v1.0.19. Native VM methods and isolated contexts retain script grammar. An explicit module-evaluation API could be designed separately if needed. Evidence: [test/vitest/repl-hook.test.ts](../test/vitest/repl-hook.test.ts), [docs/host-integrations.md](../docs/host-integrations.md). |
| How to use dedefault option?. [https://github.com/standard-things/esm/issues/885](https://github.com/standard-things/esm/issues/885) | **Covered** | Default-only .js unwrapping, mixed exports, strict .mjs, and explicit module.exports interop are documented. Keep namespace behavior for named exports. Evidence: [docs/interop-and-migration.md](../docs/interop-and-migration.md), [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| std/esm vs native esm in V14. [https://github.com/standard-things/esm/issues/880](https://github.com/standard-things/esm/issues/880) | **Scoped** | The fork's CommonJS named-export convenience is covered. Native Node's static named-export detection is not the same contract. Migration guidance should keep the default-import/destructure fallback. Evidence: [docs/interop-and-migration.md](../docs/interop-and-migration.md), [test/harness/import-tests.ts](../test/harness/import-tests.ts). |
| Using esm breaks null coalescing operator. [https://github.com/standard-things/esm/issues/879](https://github.com/standard-things/esm/issues/879) | **Covered** | Same nullish-coalescing parser mechanism as the other modern-syntax reports, including imports/comments detection. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Fix node@13+. [https://github.com/standard-things/esm/issues/876](https://github.com/standard-things/esm/issues/876) | **Covered** | The comments identify this as the type:module regression. Its concrete mechanism is covered. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| How to enable es6 import modules in Jest in a ESM used back-end?. [https://github.com/standard-things/esm/issues/875](https://github.com/standard-things/esm/issues/875) | **Scoped** | Actual ESM test-source transforms work in the installed Jest 26 suite. Add execution against newer supported Jest majors and mock APIs. A transformer-shape unit test is not that version matrix. Evidence: [test/vitest/fork-tooling-performance.test.ts](../test/vitest/fork-tooling-performance.test.ts). |
| Cache not updating when package is updated. [https://github.com/standard-things/esm/issues/874](https://github.com/standard-things/esm/issues/874) | **Scoped** | Source changes between processes invalidate compiled output. Same-process hot reload is a different module-registry problem. Retain version/source-change tests and avoid promising reload from cache:false. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts), [test/vitest/module-mocking.test.ts](../test/vitest/module-mocking.test.ts). |
| Issues integrating esm hook with mocha. [https://github.com/standard-things/esm/issues/873](https://github.com/standard-things/esm/issues/873) | **Scoped** | The Node-preload/factory entry paths are documented and checked. A bare require returns the factory. Making it globally activate would change library behavior, not merely fix Mocha configuration. Evidence: [docs/interop-and-migration.md](../docs/interop-and-migration.md). |
| Possible bug in exported proxy when esm is used in Atom package. [https://github.com/standard-things/esm/issues/872](https://github.com/standard-things/esm/issues/872) | **Covered** | Default-export instances work through .default or explicit dedefault where allowed. Preserve mixed-export namespaces instead of unwrapping them heuristically. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts), [docs/interop-and-migration.md](../docs/interop-and-migration.md). |
| Error [ERR_REQUIRE_ESM]: Must use import to load ES Module / require() of ES modules is not supported. [https://github.com/standard-things/esm/issues/868](https://github.com/standard-things/esm/issues/868) | **Covered** | The type:module CommonJS-loading mechanism has direct regressions and separate package-resolution tests. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts), [test/vitest/package-exports.test.ts](../test/vitest/package-exports.test.ts). |
| Not working with renderer process for Electron 6 or newer. [https://github.com/standard-things/esm/issues/867](https://github.com/standard-things/esm/issues/867) | **Scoped** | Original Electron 8 Linux loading/reload reproduction is verified. Preserve document-relative resolution and cold/warm behavior. Newer Electron versions require their own pinned host checks. Evidence: [docs/host-integrations.md](../docs/host-integrations.md), [test/vitest/electron-renderer.test.ts](../test/vitest/electron-renderer.test.ts). |
| Optional Chaining support. [https://github.com/standard-things/esm/issues/866](https://github.com/standard-things/esm/issues/866) | **Covered** | Optional chaining and nullish coalescing are supported by the current parser. This includes the import-in-comment and eval-string variants raised in the comments/related reports. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Need documentation about prefixing global variables into the namespace `_.g.`. [https://github.com/standard-things/esm/issues/865](https://github.com/standard-things/esm/issues/865) | **Covered** | Selected global-reference rewriting, scope/shadowing rules, and reasons for console/Reflect routing are documented and tested. Evidence: [docs/MAINTAINER_GUIDE.md](../docs/MAINTAINER_GUIDE.md), [test/vitest/compiler.test.ts](../test/vitest/compiler.test.ts). |
| Migration from @std/esm to esm. [https://github.com/standard-things/esm/issues/864](https://github.com/standard-things/esm/issues/864) | **Scoped** | Migration/interop mechanisms and __esModule export shapes are covered. Private internal packages in the original application were not available. Do not invent a default export on every namespace to conceal a shape mismatch. Evidence: [docs/interop-and-migration.md](../docs/interop-and-migration.md), [test/vitest/tooling-original-reproductions.test.ts](../test/vitest/tooling-original-reproductions.test.ts). |
| Does this support the "exports" property in package.json?. [https://github.com/standard-things/esm/issues/863](https://github.com/standard-things/esm/issues/863) | **Covered** | The exact historical folder export map and modern exports validation are covered. Private package imports mappings remain a separate confirmed gap. Evidence: [test/vitest/package-exports.test.ts](../test/vitest/package-exports.test.ts), [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| "Warning: require() of ES modules is not supported" when package.json has "type":"module". [https://github.com/standard-things/esm/issues/855](https://github.com/standard-things/esm/issues/855) | **Covered** | Cold/warm CommonJS loading of type:module files is covered without the old warning/error workaround. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Customized REPL. [https://github.com/standard-things/esm/issues/854](https://github.com/standard-things/esm/issues/854) | **Scoped** | Application-created REPL static imports are covered in global and isolated contexts. Preserve multiple-server isolation and ordinary vm.createScript behavior. Do not infer arbitrary VM module support. Evidence: [test/vitest/repl-hook.test.ts](../test/vitest/repl-hook.test.ts), [docs/host-integrations.md](../docs/host-integrations.md). |
| 3.2.25 does not work with nyc. [https://github.com/standard-things/esm/issues/852](https://github.com/standard-things/esm/issues/852) | **Covered** | Real NYC + Mocha + ts-node execution and coverage counters are tested. Keep preload ordering and instrumented cache isolation. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts), [test/vitest/coverage-cache.test.ts](../test/vitest/coverage-cache.test.ts). |
| Exporting a hoisted var-declared variable causes syntax error. [https://github.com/standard-things/esm/issues/846](https://github.com/standard-things/esm/issues/846) | **Covered** | Hoisted var exports, including the original if-block example, have direct compiler/execution regressions. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts), [test/vitest/hoisted-vars.test.ts](../test/vitest/hoisted-vars.test.ts). |
| Initial system start performance. [https://github.com/standard-things/esm/issues/844](https://github.com/standard-things/esm/issues/844) | **Scoped** | Real application startup/memory improvements have measurements. Further profiling remains valuable, but do not reuse an old synthetic startup pass as a new performance claim or add fragile timing thresholds. Evidence: [docs/tooling-and-performance.md](../docs/tooling-and-performance.md), [script/src/benchmark-startup.ts](../script/src/benchmark-startup.ts). |
| oom when js file contains zero width space unicode char. [https://github.com/standard-things/esm/issues/843](https://github.com/standard-things/esm/issues/843) | **Covered** | The original zero-width-space input and adversarial parser limits have bounded error regressions. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts), [test/vitest/parser-safety.test.ts](../test/vitest/parser-safety.test.ts). |
| Is there any docs on how to build esm?. [https://github.com/standard-things/esm/issues/841](https://github.com/standard-things/esm/issues/841) | **Covered** | Contributor build, fixture preparation, runtime globals, and canonical production checks are documented. Evidence: [docs/MAINTAINER_GUIDE.md](../docs/MAINTAINER_GUIDE.md). |
| Issues using esm on `.mjs` files from nyc since node.js 12.2.0. [https://github.com/standard-things/esm/issues/839](https://github.com/standard-things/esm/issues/839) | **Covered** | Actual NYC .mjs entry execution/instrumentation is covered. Keep distinct source and instrumentation caches. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts), [test/vitest/coverage-cache.test.ts](../test/vitest/coverage-cache.test.ts). |
| Is there a recommended way to use esm for smooth upgrade once Node.js support ESModule ?. [https://github.com/standard-things/esm/issues/838](https://github.com/standard-things/esm/issues/838) | **Covered** | Native migration boundaries and async startup are documented. Modern import.meta helpers are a newly confirmed fork gap, rather than a reason to rename every .mjs source. Evidence: [docs/interop-and-migration.md](../docs/interop-and-migration.md). |
| Esm with --inspect causes empty objects to be logged. [https://github.com/standard-things/esm/issues/824](https://github.com/standard-things/esm/issues/824) | **Covered** | Object logging under an actual --inspect listener has a dedicated regression. New inspector protocol/host versions should keep the same observable-output assertion. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| esm is broken by change in Node.js. [https://github.com/standard-things/esm/issues/821](https://github.com/standard-things/esm/issues/821) | **Covered** | Safe filesystem prototypes include inherited members, and Node fs/Stats behavior has direct coverage. Packaged virtual-filesystem cases are a separate integration target. Evidence: [src/util/safe.ts](../src/util/safe.ts), [src/fs/stat-fast.ts](../src/fs/stat-fast.ts), [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Dynamic Import Crash With Electron. [https://github.com/standard-things/esm/issues/817](https://github.com/standard-things/esm/issues/817) | **Scoped** | Patched native USB safe rejection, compatible builds, queue callbacks, and loader promise handling pass pinned Electron checks. Unpatched defective USB binaries still crash without esm. Keep the native dependency patch in the affected build pipeline. Evidence: [docs/host-integrations.md](../docs/host-integrations.md), [script/patches/usb-1.6.0-defer-queue-init.patch](../script/patches/usb-1.6.0-defer-queue-init.patch). |
| esm error: Identifier '__global__' has already been declared. [https://github.com/standard-things/esm/issues/816](https://github.com/standard-things/esm/issues/816) | **Scoped** | Repeated loader initialization is covered. The more complex two-Atom-package/shared-renderer narrative is not reproduced by that one test. An isolated multi-package/shared-realm fixture would improve evidence if extending Atom-like host support. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts), [test/vitest/electron-renderer.test.ts](../test/vitest/electron-renderer.test.ts). |
| properties will be discarded after object.assign. [https://github.com/standard-things/esm/issues/813](https://github.com/standard-things/esm/issues/813) | **Covered** | Mixed CJS/ESM export property descriptors, assigned values, spread, and Object.assign have execution regressions. Evidence: [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Deprecation warning triggered on parsing morgan. [https://github.com/standard-things/esm/issues/812](https://github.com/standard-things/esm/issues/812) | **Covered** | CommonJS default getters remain lazy, including Morgan-style deprecated getters, re-exports, and namespace access. Evidence: [test/vitest/observable-compatibility.test.ts](../test/vitest/observable-compatibility.test.ts), [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Either no module alias support or no top-level await. [https://github.com/standard-things/esm/issues/810](https://github.com/standard-things/esm/issues/810) | **Scoped** | The unchanged Babel alias/await application is verified on supported native-bridge runtimes. Node 20 timer-await behavior remains an explicit limitation, rather than a resolved legacy-host case. Evidence: [docs/tooling-and-performance.md](../docs/tooling-and-performance.md), [docs/async-module-loading.md](../docs/async-module-loading.md). |
| `esm` incorrectly proxies `Reflect` global, breaking `reflect-metadata`-like polyfills. [https://github.com/standard-things/esm/issues/809](https://github.com/standard-things/esm/issues/809) | **Covered** | Reflect polyfill identity, additions, replacements, deletion, and import paths are covered. Preserve shared observable globals without exposing the loader's protected internals. Evidence: [test/vitest/reflect-polyfills.test.ts](../test/vitest/reflect-polyfills.test.ts), [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| Something is wrong with a cache. [https://github.com/standard-things/esm/issues/805](https://github.com/standard-things/esm/issues/805) | **Scoped** | Module._load probing, cache replacement, re-export mocks, and parent-sensitive mechanisms have regressions. The upstream comments also report a later original release fixing one test. Full current rewiremock package certification still needs an actual package scenario. Evidence: [test/vitest/module-mocking.test.ts](../test/vitest/module-mocking.test.ts), [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| issue with unused imports (and libraries that monkey w/ require caches?). [https://github.com/standard-things/esm/issues/798](https://github.com/standard-things/esm/issues/798) | **Covered** | Actual proxyquire local/global stubs and the unused named import case are covered. Keep these when changing interception/caching. Evidence: [test/vitest/module-mocking.test.ts](../test/vitest/module-mocking.test.ts), [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| TypeError: Cannot read property 'options' of null. [https://github.com/standard-things/esm/issues/796](https://github.com/standard-things/esm/issues/796) | **Covered** | Cold .esmrc.js initialization and its dependency/mainFields lookups have direct regressions and failure-recovery cases. Evidence: [test/vitest/package-config.test.ts](../test/vitest/package-config.test.ts), [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| problem with mainFields. [https://github.com/standard-things/esm/issues/794](https://github.com/standard-things/esm/issues/794) | **Covered** | Actual ts-node/Babel extension hooks and module/main field selection are covered. Preserve exports precedence rather than let mainFields bypass encapsulation. Evidence: [test/vitest/fork-tooling-performance.test.ts](../test/vitest/fork-tooling-performance.test.ts), [test/vitest/package-exports.test.ts](../test/vitest/package-exports.test.ts). |
| Unable to mock `.mjs` files. [https://github.com/standard-things/esm/issues/786](https://github.com/standard-things/esm/issues/786) | **Feature** | The current strict .mjs mocking exclusion is deliberate and verified. A dedicated scoped mock API or explicit opt-in could improve test tooling, but must preserve live bindings, cycles, failures, per-loader isolation, and reset behavior. Do not silently route all native-style imports through global CJS hooks. Evidence: [test/vitest/module-mocking.test.ts](../test/vitest/module-mocking.test.ts), [src/module/esm/loader.ts](../src/module/esm/loader.ts). |
| protobufjs failing to exercise fs.readFileSync in Jest context. [https://github.com/standard-things/esm/issues/779](https://github.com/standard-things/esm/issues/779) | **Scoped** | Actual protobuf loading in the installed Jest VM and lexical eval behavior are covered. Broaden the supported Jest version matrix rather than infer it from Jest 26 alone. Evidence: [test/vitest/fork-tooling-performance.test.ts](../test/vitest/fork-tooling-performance.test.ts). |
| Weird behavior around process.on('warning') and util.deprecate. [https://github.com/standard-things/esm/issues/775](https://github.com/standard-things/esm/issues/775) | **Covered** | Chained warning listeners, util.deprecate, emitWarning ordering, and process callbacks have native-comparison regressions. Evidence: [test/vitest/observable-compatibility.test.ts](../test/vitest/observable-compatibility.test.ts), [test/vitest/upstream-regressions.test.ts](../test/vitest/upstream-regressions.test.ts). |
| jest transform support. [https://github.com/standard-things/esm/issues/706](https://github.com/standard-things/esm/issues/706) | **Scoped** | Actual Jest 26 transformed test sources, configured globals, shared bindings, and warm transforms pass. A newer transform-contract unit check exists. Add real newer-Jest execution and mock/reset/cache tests before claiming broad modern Jest compatibility. Evidence: [test/vitest/fork-tooling-performance.test.ts](../test/vitest/fork-tooling-performance.test.ts). |
| Mask stack trace in Electron renderer process. [https://github.com/standard-things/esm/issues/691](https://github.com/standard-things/esm/issues/691) | **Scoped** | The user-approved Electron renderer reconstruction passes syntax/runtime error locations and reload checks. The original deleted application is not a remaining requirement for the agreed resolution. Evidence: [docs/host-integrations.md](../docs/host-integrations.md), [test/vitest/electron-renderer.test.ts](../test/vitest/electron-renderer.test.ts). |
