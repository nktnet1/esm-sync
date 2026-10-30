# Host integration verification and remaining scope

**#867 and #915 are resolved for the original Linux reproductions.** The supplied
Arch Linux/Wayland run passed all six real-host cases: disabled, cold and warm
caches for Electron 8.0.0 and VS Code 1.66.2. Electron completed the first load
and three reloads per mode; VS Code activated the extension, executed its
command and allocated a valid port per mode. A subsequent self-contained Docker
run also passed all six cases. These results cover the tested historical
integrations.

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

## Checks and diagnostics

Docker is the only supported verification entry point. The container's internal
TypeScript verifier uses the production build and runtime archives already in
the image. It has no native CLI, external-assets option or runtime overrides.

The checker runs disabled, cold and warm disk-cache launches. Electron must
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

| Report                                                    | Result                                                            | Still needed                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [#867](https://github.com/standard-things/esm/issues/867) | Resolved: real Electron 8 first load and reloads pass             | None for the original Linux reproduction                                                  |
| [#915](https://github.com/standard-things/esm/issues/915) | Resolved: real VS Code 1.66.2 activation and port allocation pass | None for the original reproduction; UI Reload Window was not automated                    |
| [#817](https://github.com/standard-things/esm/issues/817) | Existing Node rejection/cache regressions retained                | Actual incompatible and compatible native addons, Electron run logs                       |
| [#691](https://github.com/standard-things/esm/issues/691) | Insufficient evidence to alter Chromium error presentation        | Original failing source or equivalent reproduction, current DevTools/error-event captures |
| [#886](https://github.com/standard-things/esm/issues/886) | Script-goal API boundary; supported alternative below             | No missing source for the supplied probe                                                  |

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

The reported `stack-trace-repro` branch is unavailable. The archive explicitly
contains a different upstream template at
`70df69ddc689ced92a492ccb9018cd2a7801287a`, historical screenshots, and a
**generated substitute** under `repro/renderer-stack/`. These do not establish
the current DevTools behaviour of the original application.

Run that substitute on a host with the attached Electron 5.0.6 and a display,
or supply the original failing renderer/preload files. Before the failing
inline script executes, add this diagnostic listener to the HTML page:

```javascript
window.__esmErrorReports = []
window.addEventListener("error", (event) => {
  window.__esmErrorReports.push({
    message: event.message,
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error && event.error.stack,
    versions: typeof process === "undefined" ? null : Object.assign({}, process.versions)
  })
})
```

In DevTools, copy `JSON.stringify(window.__esmErrorReports, null, 2)` and take
a screenshot showing the console's linked source location and expanded error.
Attach those with the page/renderer/preload files, exact window preferences,
and terminal output. Capture both syntax and runtime errors if possible.
Keep the listener diagnostic: do not suppress events or replace `window.onerror`.
Rewriting `error.stack` alone does not control Chromium's stored error location.

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

The supplied six-case real-host run confirms #867 and #915 as described above.
The Docker command itself could not be executed in this authoring workspace,
which has no Docker CLI/daemon. Its downloader, cache reuse, fixture fidelity,
offline run arguments, report export and failure/cleanup contracts have tests
on Node 22, 24 and 26; these do not substitute for a container run. The canonical
production build, complete typechecks/type audit, Biome and Knip were checked.
Only the small original source fixtures and their licences are checked in;
runtime archives, generated outputs, downloaded files and reports are ignored.
