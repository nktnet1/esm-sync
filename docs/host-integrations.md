# Host integration reports and remaining evidence

The five asset archives were reviewed against the supplied source bundle.
The fixes below have native Node regression coverage. An emulated module
record or a mocked host API does not prove an Electron window or VS Code
extension host works end to end.

Run both original reproductions automatically with:

`pnpm verify:hosts --assets /path/to/extracted-issue-assets`

The assets directory must contain the `issue-867` and `issue-915` folders from
the attached archives. The command builds the current production loader,
checks asset checksums, and stages private copies without installing or
downloading dependencies. It uses the attached Linux x64 Electron 8.0.0 and
VS Code 1.66.2 runtimes. On another OS, add `--electron /path/to/electron` and
`--vscode /path/to/the/actual/Code/executable` for those historical versions.
Pass `--skip-build` only when `dist/` already contains the build to verify.

The checker runs disabled, cold and warm disk-cache launches. Electron must
load the original HTML/renderer successfully and greet once on the first load
and each of three reloads. Each VS Code launch must activate the original
extension, execute its command through the real host API, and log a valid port
from the attached `get-port@6.1.2`. VS Code cases use separate fresh host
processes; they do not automate the Reload Window command. Compiler and
bootstrap cache files must exist before a warm run and remain absent when
caching is disabled. The original source files are not edited.

The command prints a report directory containing JSON results and host logs.
It exits nonzero if a check fails or a runtime, Linux library, or display is
missing; unavailable desktop checks never count as passes. On Linux, run in
an X11 desktop session or prefix the command with `xvfb-run -a` when Xvfb is
installed. No real desktop success is claimed by the checker's own unit tests.

| Report                                                    | Result                                                              | Still needed                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [#867](https://github.com/standard-things/esm/issues/867) | Fixed stale renderer-module base directory                          | Real window launch/reload results                                                         |
| [#915](https://github.com/standard-things/esm/issues/915) | Fixed native ESM rejection and virtual CommonJS host-module loading | Desktop activation/reload results from the rebuilt loader                                 |
| [#817](https://github.com/standard-things/esm/issues/817) | Existing Node rejection/cache regressions retained                  | Actual incompatible and compatible native addons, Electron run logs                       |
| [#691](https://github.com/standard-things/esm/issues/691) | Insufficient evidence to alter Chromium error presentation          | Original failing source or equivalent reproduction, current DevTools/error-event captures |
| [#886](https://github.com/standard-things/esm/issues/886) | Script-goal API boundary; supported alternative below               | No missing source for the supplied probe                                                  |

## Renderer resolution (#867)

The archive pins `aistrych/electron-quick-start` at
`9ca5498beacf08d1572ffee05df385faad261dd0` and includes Electron 8.0.0.
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

To finish browser verification:

1. Extract `source/reproduction.zip` and its supplied Linux dependency archive
   into the reproduction directory on Linux. Use native dependencies for your
   own OS/architecture elsewhere; the Linux archive is not portable.
2. Build this fork. In a disposable copy of the reproduction, replace the
   installed `esm` package with the fork's package, keeping the application's
   existing `require('esm')` calls pointed at it. Keep the original sources and
   Electron version for the first comparison.
3. Launch with the attached Electron 8.0.0 executable. On a Linux CI host this
   requires the Electron runtime's system libraries and a working display,
   such as Xvfb. This workspace lacks `libXtst.so.6` and a display service.
4. Capture the renderer console on first load and at least three reloads, with
   caching enabled and then disabled. The expected message is
   `Hello from the renderer process!` on every load.
5. Attach the exact `BrowserWindow` constructor options (including
   `nodeIntegration`, `sandbox`, `contextIsolation`, and preload path),
   `index.html`, `renderer.js`, package manifest/lockfile, logs and runtime
   versions. Also record `module.id`, `module.path`, `module.filename` and
   `module.paths` immediately before the loader factory call.

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

To verify the rebuilt loader in the actual host:

1. Extract the exact source and use its attached dependencies. From its root,
   run `node node_modules/typescript/bin/tsc -p .`. Include **all of `out/`**, its
   source maps, `src/`, `tsconfig.json`, `package.json`, and the lockfile.
2. In a disposable copy, point its existing `esm` dependency at the built fork.
   Launch the included extension debug configuration with F5 in desktop VS Code.
3. In the Extension Development Host, run **Show Port**. Capture the Debug
   Console and **Developer: Show Logs... > Extension Host** output, including
   the allocated port or complete failure stack. Repeat after Reload Window.
4. Attach **Help > About** details, `process.versions`, OS/architecture, and
   whether the extension runs locally, remotely, or in a browser host. For a
   remote extension, collect the remote Node host's details and log too.

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

The OS/Node GitHub Actions matrix and real Electron/VS Code UI hosts were not
executed here. No third-party source archives, dependencies or generated build
outputs are included in the patch.
