# Host integration verification and issue status

These statuses distinguish resolved failures from partial controls. The passing
Electron 8 reconstruction is the agreed resolution criterion for #691; recovering
the deleted original application is not required. The #917 shared-VM failure is
now verified with the current production loader in a real WebContainer. The
full #817 fix now includes a native USB source patch and automatic rebuild. This pass focuses
on #691, #817 and #917; #886 is deferred.

| Issue | Status | Verified | Still needed |
| --- | --- | --- | --- |
| [#867](https://github.com/standard-things/esm/issues/867) | **Fully resolved for the original Linux reproduction** | Electron 8.0.0: first load and three reloads, disabled/cold/warm caches; confirmed again in the latest Docker run | None for this reproduction |
| [#915](https://github.com/standard-things/esm/issues/915) | **Fully resolved for the original reproduction** | VS Code 1.66.2: activation, command and valid allocated port in all three cache modes; confirmed again in Docker | UI Reload Window remains outside the automated checks |
| [#691](https://github.com/standard-things/esm/issues/691) | **Resolved** | Docker passes the Electron 8 reconstruction: unsuppressed window events, console and native DevTools locations; syntax/runtime controls, recovery reload and all three cache modes | None; the passing reconstruction satisfies the agreed resolution criterion |
| [#917](https://github.com/standard-things/esm/issues/917) | **Resolved for the verified shared-VM failure** | Actual WebContainer on Node 22.22.3: module graph and reconstructed consumer build pass in disabled/cold/warm modes, using the Docker-built fork with globals preserved | None for this tested failure; the historical Ember dependency graph remains unverified |
| [#817](https://github.com/standard-things/esm/issues/817) | **Resolved for the pinned Linux reproduction with the native USB patch** | Patched USB rejects ABI 64 cleanly, loads ABI 70, and survives require/import, queue callbacks and debugger checks in all cache modes | Consumers need the patched USB binary; installing esm-sync alone does not repair an already-installed native binary |
| [#886](https://github.com/standard-things/esm/issues/886) | **Deferred for this pass** | Existing VM boundary documentation retained | No implementation changes requested |

The supplied 1 November run passed all fifteen offline regressions and the
three actual WebContainer graph/build cases. It predates the native USB source
fix and correctly reported the original ABI-64 crash as a blocker. v1.0.17 fixes
the native queue initialization itself, builds patched binaries for both ABIs,
and retains the original crashes as explicit negative controls. Required patched
checks must pass; an original crash alone cannot establish the fix.

The six #867/#915 passes retain their original scope. The ZIP extraction fix and
security regressions are complete; a CodeQL rerun has not been observed here.

## Docker verification

Run `pnpm verify:hosts:docker` from the repository. It requires Docker
Engine/Desktop with BuildKit and the project's normal Node/pnpm tooling, with no flags,
external assets directory, Python collector or host display configuration.
No CI workflow is added.

The command applies the checksum-pinned native USB patch and rebuilds full
USB 1.6.0 for ABIs 64 and 70 automatically. No manual package installation or
rebuild command is required. It also retains the published ABI-64 binary and
compiles unchanged ABI-64 source as negative controls. Every cache mode checks
safe rejection of the patched incompatible binary, compatible require/import,
16 native queue callbacks and debugger responsiveness. Docker can reuse build
layers; verification still validates binary digests and reruns the checks.

The small original source files and real `get-port@6.1.2` fixture are committed
under `test/fixture/hosts`, together with their licences and provenance. These
inputs need no downloads or historical dependency installation. TypeScript
tooling downloads three desktop runtime archives and Electron 5 headers during the first image
build, verifies their pinned SHA-256 hashes and caches them under the ignored
`.cache/host-runtimes/` path. Docker caches this layer independently of ordinary
loader-source changes. The image compiles a small addon for Node 24 ABI 137 and
Electron 5 ABI 70; commands, compiler versions and binary digests are exported in
`addon-builds.json`. System packages and the fork's lockfile dependencies
are also installed while building the image. The existing production build
prepares its versioned Acorn source in ignored `src/vendor`; a BuildKit cache
retains that input between source edits. The production loader is built from
the current source inside the image. Host `node_modules`, `dist`, caches and
external archives are excluded from its build context.

**A Linux PC is not required.** Docker Desktop on macOS is supported. These are
Linux/amd64 Electron, VS Code and USB checks, including when launched from macOS;
they do not test native macOS Electron binaries. Apple Silicon and other ARM
Docker hosts need Linux/amd64 emulation. The wrapper prints the container target
and the runner's platform and architecture before building.

The image includes Chromium and the checksum-pinned WebContainer SDK. The wrapper
runs two disposable containers using the same exact image ID. The first uses
`--network none` and Xvfb for all fifteen regression cases and the full USB
controls. The second uses Chromium and network access to boot a real WebContainer,
mount the Docker-built loader and the authored consumer, and run its worker.
Neither container mounts the host display or the source tree. The online phase
still runs when the offline phase returns the native USB blocker (exit 2).

The online phase connects to StackBlitz's WebContainer runtime. The mounted
payload consists of the built loader, worker code, fixtures, a reconstructed
consumer, vendored punycode and package metadata. The SDK receives this payload
and generates verification reports. It requires network access at run time;
the fifteen offline regression cases retain their separate offline guarantee.
No development dependency tree or credentials are mounted into the browser.

Reports, probe JSON, raw host logs and runtime provenance are copied back to
`.cache/host-verification/run-*/reports/` on successful and failed host runs.
Both downloads and reports are gitignored. Offline diagnostics are under
`reports/offline/`, browser and real-VM evidence under `reports/webcontainer/`,
and `reports/report.json` combines both outcomes. The runner removes only its own
two uniquely named containers after copying diagnostics. The cached image remains
available as `esm-sync-hosts:local`; report paths such as `/reports` and `/tmp`
inside the logs refer to the container. The wrapper prints the host artifact
directory and returns nonzero for failed or missing verification evidence.

ZIP extraction uses a canonical empty destination, rejects traversal paths and
symlinks, and checks the resolved target's containment immediately before its
filesystem operations. Archive regressions exercise malicious raw ZIP entries
and destinations containing existing symlinks. This addresses the reported
unsanitized archive-entry warning without suppressing the scanner.

## Output

The wrapper numbers build, offline checks, online WebContainer checks and export
as `[Step 1/4]` through `[Step 4/4]`.
Inside the image, issue groups use `[Issue 1/5]` and individual regression cases
use `[1/15]` through `[15/15]`. Each case prints its RUN and PASS/FAIL result;
subsequent cases skipped after a failure are labelled SKIP. The final summary
and `report.json` counts distinguish passed, failed and skipped cases.

USB subprocesses print their signal, timeout or nonzero exit status. A yellow
BLOCKED result is distinct from a failed assertion. The online #917 worker prints
three additional cache cases and the consumer-build evidence. A WebContainer
boot or network failure is also BLOCKED; it cannot produce a passing host result.

Status labels retain ANSI colours through Docker's piped output, without a
pseudo-terminal. Set `NO_COLOR=1` or `FORCE_COLOR=0` to disable colours. The
wrapper passes the chosen policy into the container. Successful Docker copy,
cleanup and daemon-version output is quiet; failures retain diagnostics.

## Checks and diagnostics

Docker is the only supported verification entry point. The container's internal
TypeScript verifier uses the production build and runtime archives already in
the image. It has no native CLI, external-assets option or runtime overrides.

The checker runs fifteen regression cases: disabled, cold and warm disk-cache
launches for #867, #915, the #691 reconstruction, #817's minimal native-addon
controls and #917's shared VM emulation. Six additional full USB subprocesses
and one native queue subprocess run per cache phase. The online phase adds disabled/cold/warm real WebContainer
graph checks and a consumer build in each phase. Electron must
load the original HTML/renderer successfully and greet once on the first load
and each of three reloads. Each VS Code launch must activate the original
extension, execute its command through the real host API, and log a valid port
from the checked-in `get-port@6.1.2`. VS Code cases use separate fresh host
processes; they do not automate the Reload Window command. Compiler and
bootstrap cache files must exist before a warm run and remain absent when
caching is disabled. The original source files are not edited.

Both hosts always run through `xvfb-run -a` with `GDK_BACKEND=x11` and the
testing-only `--no-sandbox` flag inside the disposable container. The image
supplies the display libraries, Xvfb and xauth. This works from a Wayland
session without host display configuration.

Fontconfig warning/error lines are hidden from failure messages automatically.
Raw stdout/stderr, log files and failure reports retain those diagnostics.
Other errors and the host's exit status still determine the result.

Failures include the attempted command, cache phase, exit code/signal, probe
errors, captured stdout/stderr, and paths to the complete log and probe result.
Output is retained for startup failures and timeouts as well as module errors.
Open `report.json`, the individual probe JSON and the raw `.log` files in the
exported reports directory to inspect a previous run without launching Docker
again. Missing runtimes, libraries, displays or probe results count as failures.
Tooling unit tests do not by themselves establish a real desktop-host pass.

VS Code 1.66.2 installs `console.log` as a configurable accessor whose setter
ignores assignments. The port observer replaces that property descriptor for
the duration of the test and restores the original descriptor on success or
failure. The probe requires a valid port from the original activation,
successful command execution, and no rejection; the activation greeting alone
is insufficient evidence.

## Renderer resolution (#867)

The fixture pins `aistrych/electron-quick-start` at
`9ca5498beacf08d1572ffee05df385faad261dd0`; the image uses Electron 8.0.0.
Its embedded renderer initialisation creates
`new Module('electron/js2c/renderer_init')`, then sets `filename` to the HTML
page and `paths` to the page's module search paths. It leaves `path` pointing
at `electron/js2c`. The fork preferred that stale `path` and reproduced the
reported `Cannot find module './renderer.js'` failure.

The loader now derives that injected module's directory from its page filename.
It does not mutate the supplied module record. Ordinary application modules,
custom paths and filename-less renderer records retain their existing semantics.
`test/vitest/electron-renderer.test.ts` covers two page directories, a misleading
cwd, spaces/Unicode/special characters in paths, local dependencies, repeated
factories, a bootstrap and inline script in a separate VM realm, and repeated
fresh-process cache loads. Explicit relative and absolute module paths are
preserved. These checks reproduce the supplied module shape in Node; they do
not launch Chromium.

The supplied successful host runs complete browser verification in all three
cache modes, including first load and three reloads in each. Repeat the checks
with `pnpm verify:hosts:docker`.

The fix supplies no Node APIs to a sandboxed or browser-only context. Do not
change isolation settings merely to make the historical reproduction pass.

## VS Code extension loading (#915)

The exact source at `50431382967ed8d6ca45e81433b2c753c5356a70` compiles with
the attached TypeScript 4.x dependencies. Its output requires ESM-only
`get-port@6.1.2` from CommonJS, then requires the virtual `vscode` module.
The second step exposed a separate fork defect: it insisted on resolving a
filesystem filename before consulting the native host's `_load` interceptor.
VS Code's [Node extension service](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/node/extHostExtensionService.ts)
provides per-extension APIs through that interceptor.

After an unresolved bare CommonJS request, the loader now consults the native
host with the original parent module. It does not invent filenames or put
per-extension APIs into a shared cache. Resolution through `exports` remains
authoritative, `.mjs` imports retain their strict resolution behaviour, and
execution failures are not retried through the host.

The supplied VS Code 1.66.2 failure logs exposed an earlier step: its native
`.js` handler rejects `get-port` with `ERR_REQUIRE_ESM` before calling
`_compile`. Modern Node's native `require(esm)` had hidden that defect in the
original regression. The loader now falls back to its installed compiler only
for a `.js` ESM rejection before compilation starts. Errors thrown after
compilation begins keep their identity and do not trigger a second execution.
The host regressions disable native `require(esm)` explicitly to retain the
legacy failure path on current Node versions.

`test/vitest/host-modules.test.ts` verifies host hooks installed before and
after initialisation, independent extension parents, an asynchronous ESM port
provider, cold/warm runs, host error identity, exports encapsulation and single
execution on failure. The original compiled extension was also exercised in
Node with a stubbed `vscode` API and the real attached `get-port` dependency.
That check supplied a loopback-only `os.networkInterfaces()` result because
network-interface enumeration is unavailable in this workspace. It is not an
actual VS Code activation result.

The supplied Arch Linux/Wayland host results confirm real VS Code 1.66.2 success
with caching disabled, cold and warm. The detailed report allocated port 13604,
executed the command and reported no runtime errors in each mode. The later
six-case successful run also verifies Electron 8 in all cache modes after
selecting the X11 GTK backend for Xvfb. Fontconfig diagnostics were present in
passing VS Code launches, so they do not by themselves establish a loader failure.

Repeat the original extension checks with `pnpm verify:hosts:docker`. Testing
VS Code's **Reload Window** action remains a separate manual check.

## Electron dynamic imports and native addons (#817)

The committed original application is pinned at
`5e0749955d9489a30f742f5597f432dc4a6b1562`. Its unmodified `crash.js` has a valid
`.catch(error => ...)` callback. The Docker check replaces USB with a clearly
labelled minimal native addon, compiled from one C++ source for Node 24 ABI 137
and Electron 5 ABI 70. No Python or historical node-gyp installation is needed.

Actual Electron 5.0.6 checks passed with disabled, cold and warm caches.
Ordinary require and dynamic import reject the incompatible binary; the rebuilt
binary exposes the expected exports. Four repeated/concurrent failed imports
must reject, and four compatible imports must expose real values. The original
JavaScript logs `error` then `success` in separate package graphs. Three debugger
round trips verify renderer liveness. This Electron version omits an error
`code`, so the checks validate the actual ABI message.

The same minimal controls also pass with upstream `esm@3.2.25`. They do not
reproduce the USB-specific hang and cannot establish that it is fixed. The
existing incomplete-CommonJS-cache correction has separate regressions.

The full-package checks locate a native USB 1.6.0 defect: global `UVQueue`
constructors call libuv before Node validates the addon ABI. Rejecting the addon
unloads the library while libuv retains references to its global storage. The
published binary and a freshly compiled unchanged ABI-64 binary both catch the
64/70 mismatch and then crash without esm. Native stack diagnostics capture the
subsequent libuv failure.

`script/patches/usb-1.6.0-defer-queue-init.patch` makes construction inert,
initializes completion queues in `Transfer::Init`, initializes the hotplug queue
before enabling events, and avoids closing an uninitialized queue. Initialization
is idempotent. The TypeScript builder verifies the input and resulting source
hashes before compiling both native ABIs. This changes USB's native source;
it does not add a loader hook that rewrites consumers' installed binaries.
The verifier exports the native patch as `offline/usb-native-fix.patch`.

## Chromium error presentation (#691)

The deleted `stack-trace-repro` branch was not recovered. The committed
`test/fixture/hosts/issue-691` is an authored reconstruction of the reported
invalid renderer `await`, plus a runtime-error control. Earlier searches found
no branch in the current repository or seven Software Heritage snapshots;
Wayback was unavailable. This does not establish that every archive is absent.

The previous fix corrected the formatted stack and native captured frames.
The user's failing run exposed another location: Chromium reports the last
explicit throw separately. The outer module-load catch rethrew inside the
loader. Renderer errors now leave that boundary through a small source-mapped
VM function at the original filename, line and column. It throws the same
object, including cached runtime failures. Invalid location data or unavailable
VM functionality falls back to the original thrown value.

The probe loads the page before attaching the debugger, bounds each stage,
and checks window events, console messages, `Runtime.exceptionThrown`'s own
location and its native frames. Its window listener only records evidence:
it does not suppress errors or replace `window.onerror`. A healthy reload after
both errors verifies recovery and lets Electron 8 persist the previous
renderer's cache on a real navigation. Shutdown detaches and quits normally.

Actual pinned Electron 8 checks passed in disabled, cold and warm modes:
syntax at line 2, column 3, and runtime at line 2, column 9. Both window and
DevTools locations name the source. Native inspector regressions also cover
first-line errors, special-character paths, source maps, repeated errors,
runtime-error identity and invalid user-supplied stack locations.

The user confirmed that `pnpm verify:hosts:docker` passes all twelve cases,
including the three #691 cache modes. **#691 is resolved.** The passing
reconstruction satisfies the agreed resolution criterion; recovering the deleted
branch or its historical Electron version is not a remaining requirement.

## Shared-realm VM emulation (#917)

The upstream report links WebContainers' VM emulation modifying the host global
and making `Object` disappear. The existing fix tests a literal's intrinsic
constructor before deleting or reparenting builtins. A shared host realm uses
its existing intrinsics; isolated native contexts retain their preparation.

The native shared-realm regression fails before the guard and passes with it
in disabled, cold and warm configurations, preserving host builtin descriptors.
A real session of the linked StackBlitz project reported Node 22.22.3 and shared
VM intrinsics. The published `esm-sync@3.4.0` loaded an ESM smoke module with
answer 42 and retained `Object`; upstream `esm` failed that smoke load with a
`Function.prototype.apply` TypeError.

The guard was also applied to the isolated published test package. The linked
Ember preview boots on the current runtime, but the replacement-package build
did not establish that its historically failing loader path ran. This is
partial verification, not a claim that the original 2022 application failure
was reproduced and fixed. A passing Docker Node shim cannot close that gap.

## Static imports in VM scripts (#886)

The supplied `vm-run-in-this-context.cjs` probe is sufficient to demonstrate
the boundary. `vm.runInThisContext()` evaluates a **script**, where static
`import` declarations are invalid. The CLI/REPL hooks do not turn arbitrary VM
script evaluation into a module loader. The probe's caught `SyntaxError` and
zero exit status mean it reproduced the boundary, not that it imported a module.

Load the existing file explicitly through the supported factory instead:

```javascript
const load = require("esm-sync")(module)
const test = load("./index.mjs").default
```

For an isolated module graph, use Node's `vm.SourceTextModule` with an explicit
linker and asynchronous evaluation. That is a different API and may require
the relevant Node runtime's VM-module flag. No global VM monkey-patch or silent
change to the script API is included here.

## Full USB and real WebContainer verification

Run `pnpm verify:hosts:docker` for fifteen offline regressions, eighteen full
USB subprocesses and three native queue checks, followed by real WebContainer
verification. Build inputs are checksum-pinned USB 1.6.0, nan 2.13.2, bindings
1.5.0, file-uri-to-path 1.0.0, the published ABI-64 binary, Node 10.24.1 headers
and Electron 5.0.6 headers. The build uses bundled libusb and its supported Linux
netlink backend. Downloaded packages, sources, binaries and reports remain
ignored. No Python collector or dependency lifecycle scripts are used.

Each #817 phase prints `[USB 1/6]` through `[USB 6/6]`:

1. Published ABI-64 binary under ordinary require - original negative control.
2. Fresh unchanged ABI-64 build under ordinary require - source negative control.
3. Patched ABI-64 build under ordinary require - must reject and stay alive.
4. Patched ABI-64 build through dynamic import - repeated/concurrent rejections must settle.
5. Patched ABI-70 build under ordinary require - must load and stay alive.
6. Patched ABI-70 build through dynamic import - must load and keep the debugger responsive.

The original controls must record the matching ABI error followed by an observed
SIGSEGV, exit 139 or timeout, or demonstrate healthy rejection themselves. An
unrelated startup failure is not acceptable evidence. Their raw native crash
stacks are retained when available. Four patched cases must actually pass.
A separate ABI-70 addon exercises the exact patched queue header with repeated
initialization, sixteen callbacks and an event-loop liveness check. Missing,
stale or incorrect native evidence fails verification and the Docker aggregate
validator independently checks it.

`usb-builds.json` records patch and source hashes, headers, compiler commands,
four binary digests and the queue/stack diagnostic digests. Inspect
`817-usb-<phase>.json` and referenced logs/results. A caught rejection followed
by a crash in a patched case never passes. A patched ordinary-require crash
remains BLOCKED; a failed compatible control or queue check is FAILED.

Exit 0 requires all offline regressions, patched full USB checks, native queue
checks and the real WebContainer phase to pass. Exit 1 means a failed check or
missing evidence. Exit 2 means patched USB still cannot reject safely, or the
WebContainer environment is unavailable, without a higher-priority failure.
The original defective binaries are retained as negative controls after the
actual native repair; they no longer force exit 2 when the fixed binaries pass.

A Linux PC is not required: Docker Desktop on macOS runs the same Linux/amd64
checks. Native macOS Electron is outside this scope. USB may report a libusb
initialization error without device access; reports retain it and require the
actual `.node` handler to have loaded. The separate native queue check remains
required even when USB supplies fallback JavaScript APIs after such an error.
When libusb initializes, the probe also toggles attach/detach listeners. No
physical USB devices are opened by these tests.

The #917 Docker cases preserve builtin descriptors, load a CommonJS/ESM graph,
check repeated loads and caught dynamic-import failures, and require a real
compiler-cache file before the warm run. A separate copy of the production
bundle has only its shared-realm guard disabled; it must fail specifically when
context preparation deletes the live Object. The tested loader is unchanged.
Upstream esm is not a suitable negative control because it also fails on modern
Node for unrelated reasons. Docker's scope is `shared-realm-vm-regression`.

The same `pnpm verify:hosts:docker` command now handles actual-host verification
without opening a browser, transferring a ZIP, extracting files or entering a
second command. A local HTTP harness serves the pinned `@webcontainer/api@1.6.4`
SDK and the worker, with the required cross-origin isolation headers. Headless
Chromium boots the SDK, mounts the worker and starts it in the actual WebContainer.
The build compiles the TypeScript worker to JavaScript, so the VM needs no native
TypeScript support, development dependencies, package installation or build step.

The worker verifies that VM contexts share the host's Object without replacing
VM APIs, then repeats the graph and the reconstructed consumer's build in three
fresh cache-mode processes. A child-process preload redirects `esm` requests to
the Docker-built fork, observes actual factory calls and compares builtin
descriptors on exit. A build that exits zero without invoking the fork fails.
Ordinary native Node also fails the real-host assertion instead of being counted
as WebContainer coverage.

The browser exports worker reports and raw logs automatically. The validator
requires the current run nonce, matching offline/online loader digests, a booted
and isolated browser, three unique cache phases, real shared-VM probe evidence
and successful consumer builds that used the fork. A stale report, emulated VM,
unused loader or runtime error cannot produce a passing result. The generated
worker ZIP is retained only as a diagnostic artifact; no manual transfer is
required. The public `verify:webcontainer` script is removed.

This is a newly authored consumer under `test/fixture/hosts/issue-917/application`,
not the original Ember dependency graph. The earlier linked Ember build on
WebContainer Node 22.22.3 exited zero but invoked no esm factory, so it remains
insufficient evidence for that historical application. A pass from this command
verifies the current loader's shared-VM regression and reconstructed build in a
real WebContainer; it does not establish the historical Ember failure is fixed.

A further direct real-host check of the published fork with the same shared VM
guard passed the CommonJS/ESM graph, repeated loads, builtin preservation and
three caught dynamic-import rejections in all three cache modes. This verifies
the regression shape in the real VM; it is separate from testing this checkout's
Docker-exported loader or a build that actually invokes the old application path.

The latest supplied Docker reports now verify this checkout's production loader
in the actual WebContainer as well. The strict browser-report validator accepts
all three cache phases, with `sharedRealm: true`, two graph imports, three caught
dynamic-import rejections and all eight builtin descriptors preserved per phase.
The reconstructed consumer invokes the fork's factory once in each build and
exits 0. The VM reports Node 22.22.3 and WebContainer build `f8d6b2be`; the browser
is Chromium 156.0.8078.73 with SDK 1.6.4 and cross-origin isolation enabled.

The offline, real-host and exported ZIP copies share production loader SHA-256
`8b771daf822c8672d82a3ac9eca405493bc1a384b9b13f8c77266f1e1c9b9ed3`.
The embedded worker report matches the browser's exported worker data. This
resolves the verified shared-VM corruption failure and validates the reconstructed
consumer in the real host. It does not certify the historical Ember graph.

### WebContainer worker startup diagnostics

The earlier supplied `report.json`, `events.json` and browser log showed successful SDK
boot and mount, followed by a failure before worker output. The old handler
converted a plain exception object to `[object Object]`, losing its fields.
The runner also passed the absolute `workdir` as `spawn.cwd`, although the
[API defines this option relative to the instance working directory](https://webcontainers.io/api#spawnoptions-properties).
The corrected spawn omits `cwd` to use the documented default and preserves the
SDK's `PATH` when setting the worker's environment. This fixes the API usage;
the old exception's hidden details prevent proving that it was the sole cause
of that run's failure.

The latest supplied run passes after this correction, including all three actual
WebContainer worker phases and consumer builds. Worker startup is no longer an
outstanding verification requirement.

The browser now distinguishes `spawn`, `run` and `collect` failures. It retains
structured exception fields, circular causes, the attempted command, runtime
directory and partial VM artifacts. `webcontainer/worker.log` records process
output even when the worker fails before creating `report.json`. The final Docker
error includes the stage and underlying browser error instead of only displaying
the nonzero exit assertion. A missing report, rejected output stream or failed
worker remains a failure.

## Validation

The delivered v1.0.17 patch passes 208 focused production tests on each of Node
22.23.4, 24.21.0 and 26.12.0, including native evidence rejection, archive
containment, portable worker execution and both Docker orchestration phases
with simulated outcomes. The production build, TypeScript checks, owned-type
audit, Biome and Knip pass. Both native USB ABIs, the unchanged ABI-64 control,
the queue addon and native stack recorder compile successfully. Fresh direct
Electron 5 embedded-Node checks pass six patched ordinary-require cases and
three queue cases across all cache modes, while both original binaries reproduce
SIGSEGV in each mode and retain native stack diagnostics. These direct checks
are separate from the earlier full GUI/debugger run described below.


The v1.0.14 verification tooling passed 188 focused tests on each of Node 22,
24 and 26. These include archive security, native-failure classification, the
guard counterfactual, dependency-free compiled-worker and consumer execution,
both Docker phases with simulated outcomes, browser-page execution with an
in-memory SDK stub, localhost isolation headers and strict real-host evidence
validation. Startup and partial-failure regressions cover the documented SDK
working-directory contract, plain/circular exceptions and rejected exit/output
promises. TypeScript checks, owned-type auditing, Biome and Knip pass. The
production build passes and its loader digest remains
`8b771daf822c8672d82a3ac9eca405493bc1a384b9b13f8c77266f1e1c9b9ed3`.

The supplied passing actual WebContainer run remains the evidence for #917.
No new real WebContainer run or complete updated Docker image was executed in
this authoring environment. The earlier native investigation passed twelve
patched full-package checks, six original negative controls and three queue
checks in actual Electron 5.0.6 across disabled/cold/warm modes, including Xvfb
and debugger round trips. The native USB fix is separate from the unchanged
production loader. The delivered patch is rebuilt and checked before export.

Focused host/renderer/shared-VM/upstream checks passed 132 tests each on Node 22
and 26. The Node 24 production run covered 1,655 tests: 1,510 passed initially;
the 145 failures were missing Test262 fixtures. After restoring the pinned
fixtures, a 200-test rerun passed, covering those failures and the host checks.
The final patch is also rebuilt and checked before delivery.

Production builds, TypeScript checks, owned-type auditing and the supplied
Biome check cover the changed code. Runtime archives, downloaded headers,
binaries, caches and reports are ignored. Only source fixtures and licences
are included in the patch. No CI workflow is added.
