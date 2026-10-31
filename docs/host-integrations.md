# Host integration verification and issue status

These statuses cover the historical Linux integrations tested in this work.
"Fully resolved" means the original host reproduction passed. "Partially
resolved" means a verified component fix exists, with host work still open.

| Issue | Status | Verified | Still needed |
| --- | --- | --- | --- |
| [#867](https://github.com/standard-things/esm/issues/867) | **Fully resolved for the original Linux reproduction** | Electron 8.0.0: first load and three reloads, disabled/cold/warm caches; confirmed again in the latest Docker run | None for this reproduction |
| [#915](https://github.com/standard-things/esm/issues/915) | **Fully resolved for the original reproduction** | VS Code 1.66.2: activation, command and valid allocated port in all three cache modes; confirmed again in Docker | UI Reload Window remains outside the automated checks |
| [#691](https://github.com/standard-things/esm/issues/691) | **Partially resolved; Electron verification pending** | Native V8 locations and source maps pass regression tests; the reproduced Docker check exposed a probe startup deadlock, fixed in this patch | Rerun the updated Docker command and inspect the actual window events and DevTools frames |
| [#917](https://github.com/standard-things/esm/issues/917) | **Partially resolved; StackBlitz verification pending** | Shared-VM global corruption reproduced and fixed in native regressions | Run the patched package in real WebContainers and the affected application |
| [#817](https://github.com/standard-things/esm/issues/817) | **Partially resolved** | Node rejection and cache-corruption fixes verified | Original Electron 5 native-addon mismatch/hang, using actual incompatible and rebuilt addons |
| [#886](https://github.com/standard-things/esm/issues/886) | **Not implemented: API boundary** | `vm.runInThisContext` accepts scripts; documented alternatives can load modules | Automatic static-import support would require a separate feature decision |

Overall Docker success requires all nine cases. The six recorded #867/#915
passes establish their individual results while #691 remains open. The ZIP
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
tooling downloads only the two desktop runtime archives during the first image
build, verifies their pinned SHA-256 hashes and caches them under the ignored
`.cache/host-runtimes/` path. Docker caches this layer independently of ordinary
loader-source changes. System packages and the fork's lockfile dependencies
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
Inside the image, issue groups use `[Issue 1/3]` and individual cache cases
use `[1/9]` through `[9/9]`. Each case prints its RUN and PASS/FAIL result;
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

The checker runs nine cases: disabled, cold and warm disk-cache launches for
#867, #915 and the #691 reconstruction. Electron must
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

The source is pinned at `5e0749955d9489a30f742f5597f432dc4a6b1562`.
`crash.js` has a valid `.catch(error => ...)` callback. Existing regressions
cover rejected dynamic imports of malformed native files and repeated/concurrent
failure without reusing incomplete CommonJS linking records. The existing
roadmap separately records earlier manual verification of an actual Node ABI
mismatch; the malformed-file regression is not that experiment.

The supplied USB rebuild failed in `node-gyp@4.0.0` because its required Python
toolchain was unavailable. There is **no compiled Linux `.node` addon** in the
archive. A missing binary tests `MODULE_NOT_FOUND`, not the reported ABI mismatch.
The Electron 5 process hang therefore remains unverified.

To provide the missing files:

1. On the failing OS/architecture, preserve the original application and the
   addon compiled for the incompatible Node ABI. Attach the actual `.node`
   file(s), the USB package files, lockfile, and full native-build log.
2. Run the original app with that binary and capture the main-process output,
   renderer output, caught error's `code/message/stack`, whether DevTools
   disconnects, and whether the process exits or hangs. Run both original `esm`
   and the fork against the same binary. Also run the equivalent ordinary
   `require('usb')` control.
3. Save that binary separately before rebuilding. In the reproduction's
   supported historical build environment, run its existing `npm run rebuild`
   (Electron rebuild), save the rebuilt `.node` separately, and repeat the runs.
   Include both rebuild logs; do not replace this evidence with a fresh modern
   USB package or a text file renamed to `.node`.
4. Record Electron, embedded Node, `process.versions.modules`, OS and
   architecture, USB/rebuild versions, compiler and Python versions for both
   binaries. If the real application cannot be shared, supply a minimal native
   addon that produces the same ABI rejection in the same Electron runtime.

## Chromium error presentation (#691)

The deleted `dsanders11/electron-quick-start` branch `stack-trace-repro` could
not be recovered. The current repository was created after the original report.
All seven available Software Heritage snapshots (2020–2023) were checked;
none contains that branch. Wayback's index returned its temporarily-offline
page. This search does not establish that every possible archive is absent.

The original [issue and example](https://github.com/standard-things/esm/issues/691)
describe an invalid `await` in a renderer module. The committed
`test/fixture/hosts/issue-691` recreates that case and adds a normal runtime
exception as a control. It is newly authored under this repository's licence,
not a copy of the deleted branch. It uses the same pinned Electron 8.0.0 runtime
as #867, so it adds no runtime download.

The loader already formatted `error.stack`, but DevTools also reads native V8
capture data. Parser-created renderer errors now recapture their original file,
line and column before the stack getter is installed. A source map includes the
original source and maps the generated capture back to its exact position.
Runtime errors retain their existing capture and identity.
This change installs no renderer error listener in the loader.

The earlier probe awaited `Runtime.enable` before its first navigation. Electron
can keep that debugger promise pending until navigation, leaving the probe
unable to reach `loadFile`. The corrected probe loads and checks the page first,
then attaches the debugger. Each asynchronous startup/error-collection stage
has its own deadline. Failure JSON records the stage, recent renderer console
messages, navigation failures, debugger detach reasons and exception events.
A native mock-host regression reproduces the startup deadlock and tests stalled
commands, navigation failures and detached targets. It does not launch Electron.

Run `pnpm verify:hosts:docker` to exercise all nine host cases. The three #691
cases require both `window` error events and DevTools `Runtime.exceptionThrown`
data to name the failing source and line. The probe also checks that errors
remain unsuppressed, records raw event fields and inspector frames in
`691-<phase>.json`, and tests a successful module so cache persistence is
verified. The window listener only records evidence; it does not call
`preventDefault`, return a suppression value or replace `window.onerror`.

Native Node inspector regressions cover first-line and later-line syntax
errors and a runtime-error control. They demonstrate the V8 capture correction,
but they do not establish Chromium's event presentation. The recreated
Electron check must pass in the actual container before this integration is
marked resolved. No result is claimed for the deleted original application or
its historical Electron version.

## Shared-realm VM emulation (#917)

The [upstream report](https://github.com/standard-things/esm/issues/917) links
StackBlitz's loader conflict. Its maintainers later traced the missing `Object`
to [VM emulation modifying the host global](https://github.com/stackblitz/webcontainer-core/issues/692#issuecomment-1122128649).

The loader previously deleted shadowed builtin properties while discovering
an isolated context's intrinsics, then restored them and connected their
prototypes. In an emulated context backed by the host realm, that process can
delete live host globals. Context preparation now first evaluates a literal's
intrinsic constructor without changing any global. If the context shares the
host's `Object`, it uses that existing realm directly. Isolated native VM
contexts continue through the existing preparation path.

`test/vitest/webcontainer.test.ts` emulates that shared-realm context and loads
an ESM file through the built loader. It checks host builtin descriptors with
disabled, cold and warm caches. The old loader fails with `Object` missing;
the patched loader passes. This is a regression of the behaviour described by
the maintainer, not an execution of WebContainers. A real StackBlitz session
with the patched package and the affected application remains necessary to
close #917. An ordinary Docker Node process cannot supply that evidence.

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

Validation used only the supplied dependencies and runtimes on Linux x64:

- Canonical development and production-test builds on Node 24.21.0.
- Full development suite: 1,589 passing tests. Full production suite: 1,591
  passing tests. The two additional CI classifier cases are also covered by
  the final 33-test CI policy/workflow rerun.
- Host, renderer, mocking, exports and upstream regressions: 104 passing tests
  each on Node 22.23.4 and 26.12.0 with the production-test build.
- Final host/renderer tests explicitly disable caching for the uncached cases
  and repeat fresh processes with caching enabled for the cached cases.
- Full implementation/tooling/declaration typechecks and the owned-type audit;
  the attached Biome binary and the CI-pinned Biome check both pass.
- The supplied VM probe and original compiled extension mechanisms were checked
  on Node 22/24/26, within the host limitations described above.

The supplied six-case real-host runs confirm #867 and #915 as described above.
The updated nine-case command adds the recreated #691 checks; those new cases
have not yet run in the authoring environment.
The Docker command itself could not be executed in this authoring workspace,
which has no Docker CLI/daemon. Its downloader, cache reuse, fixture fidelity,
offline run arguments, report export and failure/cleanup contracts have tests
on Node 22, 24 and 26; these do not substitute for a container run. The canonical
production build, complete typechecks/type audit, Biome and Knip were checked.
Additional verification for the #917/#691/archive changes:

- The shared-realm VM regression failed before the fix with the host's `Object`
  missing. Disabled, cold and warm runs pass after the fix.
- Native renderer inspector checks pass on Node 22.23.4, 24.21.0 and 26.12.0.
  They verify raw V8 locations, independently decoded source-map file/line/column
  mappings (including special-character paths), and runtime-error identity.
- All 1,646 production cases were covered across the broad run and the corrected
  PATH rerun: 1,626 passed initially, and all 106 scenario cases passed after
  adding the normal `node_modules/.bin` script PATH, including the 20 initial
  command-not-found failures.
- ZIP extraction tests exercise raw traversal entries, symlinks, executable
  permissions and canonical destinations. Typechecks/type audit, the production
  build, Biome and Knip pass.

Only the small source fixtures and their licences are checked in; runtime
archives, generated outputs, downloaded files and reports are ignored.
