# Host integration verification and issue status

These statuses distinguish resolved failures from partial controls. The passing
Electron 8 reconstruction is the agreed resolution criterion for #691; recovering
the deleted original application is not required. The minimal #817 controls and
#917 smoke check leave their full application failures open. This pass focuses
on #691, #817 and #917; #886 is deferred.

| Issue | Status | Verified | Still needed |
| --- | --- | --- | --- |
| [#867](https://github.com/standard-things/esm/issues/867) | **Fully resolved for the original Linux reproduction** | Electron 8.0.0: first load and three reloads, disabled/cold/warm caches; confirmed again in the latest Docker run | None for this reproduction |
| [#915](https://github.com/standard-things/esm/issues/915) | **Fully resolved for the original reproduction** | VS Code 1.66.2: activation, command and valid allocated port in all three cache modes; confirmed again in Docker | UI Reload Window remains outside the automated checks |
| [#691](https://github.com/standard-things/esm/issues/691) | **Resolved** | Docker passes the Electron 8 reconstruction: unsuppressed window events, console and native DevTools locations; syntax/runtime controls, recovery reload and all three cache modes | None; the passing reconstruction satisfies the agreed resolution criterion |
| [#917](https://github.com/standard-things/esm/issues/917) | **Partially resolved** | Shared-VM corruption regression fixed; published fork loads a smoke module in real WebContainers | Confirm the original failing application path with the guard |
| [#817](https://github.com/standard-things/esm/issues/817) | **Partially resolved; full USB case open** | Actual Electron 5: minimal ABI 137/70 addons, repeated/concurrent rejection, rebuilt control and responsive debugger | Full USB mismatch also crashes ordinary require in the new native build; original loader-specific hang remains unverified |
| [#886](https://github.com/standard-things/esm/issues/886) | **Deferred for this pass** | Existing VM boundary documentation retained | No implementation changes requested |

The user confirmed that all twelve Docker cases pass. Reports label #817 samples as
`minimal-native-addon` and #691 samples as `reconstructed-renderer`. These
scopes prevent a passing control from being mistaken for a full historical
application result. The six #867/#915 passes retain their original scope. The ZIP
extraction code fix and security regressions are complete; a CodeQL rerun has
not been observed in this authoring environment.

## Docker verification

Run `pnpm verify:hosts:docker` from the repository. It requires Docker
Engine/Desktop with BuildKit and the project's normal Node/pnpm tooling, with no flags,
external assets directory, Python collector or host display configuration.
No CI workflow is added.

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

The finished Linux/amd64 image contains everything needed for verification.
The runner uses `--network none`, Xvfb and a private shared-memory allocation;
it mounts neither the host display nor the source tree. ARM Docker hosts need
Linux/amd64 emulation. The exact built image ID is used for the run and recorded
in `docker.json`, so concurrent rebuilds cannot switch a running test to a
different tagged image.

Reports, probe JSON, raw host logs and runtime provenance are copied back to
`.cache/host-verification/run-*/reports/` on successful and failed host runs.
Both downloads and reports are gitignored. The runner removes only its own
uniquely named container after copying diagnostics. The cached image remains
available as `esm-sync-hosts:local`; report paths such as `/reports` and `/tmp`
inside the logs refer to the container. The wrapper prints the host artifact
directory and returns nonzero for failed or missing verification evidence.

ZIP extraction uses a canonical empty destination, rejects traversal paths and
symlinks, and checks the resolved target's containment immediately before its
filesystem operations. Archive regressions exercise malicious raw ZIP entries
and destinations containing existing symlinks. This addresses the reported
unsanitized archive-entry warning without suppressing the scanner.

## Output

The wrapper numbers build/run/export as `[Step 1/3]` through `[Step 3/3]`.
Inside the image, issue groups use `[Issue 1/4]` and individual cache cases
use `[1/12]` through `[12/12]`. Each case prints its RUN and PASS/FAIL result;
subsequent cases skipped after a failure are labelled SKIP. The final summary
and `report.json` counts distinguish passed, failed and skipped cases.

Status labels retain ANSI colours through Docker's piped output, without a
pseudo-terminal. Set `NO_COLOR=1` or `FORCE_COLOR=0` to disable colours. The
wrapper passes the chosen policy into the container. Successful Docker copy,
cleanup and daemon-version output is quiet; failures retain diagnostics.

## Checks and diagnostics

Docker is the only supported verification entry point. The container's internal
TypeScript verifier uses the production build and runtime archives already in
the image. It has no native CLI, external-assets option or runtime overrides.

The checker runs twelve cases: disabled, cold and warm disk-cache launches for
#867, #915, the #691 reconstruction and #817's minimal native-addon controls. Electron must
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

A further experiment compiled actual `usb@1.6.0`, using `nan@2.13.2`,
`bindings@1.5.0` and `file-uri-to-path@1.0.0`, for Node 12 ABI 72 and Electron
ABI 70. The incompatible binary also crashes ordinary require with SIGSEGV in
libuv, without loading esm. USB's global `UVQueue` constructors initialise
libuv handles before Node rejects the ABI. This build cannot distinguish the
historical loader failure from native failure. Experimental downloads and
binaries remain ignored and are not inputs to the passing minimal controls.

The full issue remains open until the original binary/toolchain is recovered
or another full USB mismatch safely rejects under ordinary require and exposes
a loader-specific failure. The JavaScript loader cannot repair a native
process crash.

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

## Validation

Actual pinned Electron checks passed for #691,
#817's minimal addon controls and #867, each with disabled, cold and warm caches.
The latest user-confirmed Docker run passes all twelve cases for #867, #915,
#691 and #817's minimal addon controls. This completes #691 verification; the
limited #817 controls do not close the full USB issue. #917 remains partially
resolved and is not covered by the Docker host cases.

Focused host/renderer/shared-VM/upstream checks passed 132 tests each on Node 22
and 26. The Node 24 production run covered 1,655 tests: 1,510 passed initially;
the 145 failures were missing Test262 fixtures. After restoring the pinned
fixtures, a 200-test rerun passed, covering those failures and the host checks.
The final patch is also rebuilt and checked before delivery.

Production builds, TypeScript checks, owned-type auditing and the supplied
Biome check cover the changed code. Runtime archives, downloaded headers,
binaries, caches and reports are ignored. Only source fixtures and licences
are included in the patch. No CI workflow is added.
