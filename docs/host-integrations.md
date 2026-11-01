# Host integrations

Run the complete automated host checks on macOS or Linux with Node 24.14+ and
Docker Engine/Desktop:

```sh
pnpm verify:hosts:docker
```

The standalone equivalent is `node script/src/esm/verify-hosts-docker.ts`; no
host dependency install is needed. `verify:all` includes this command.
Docker Desktop on Apple Silicon uses Linux/amd64 emulation. Image construction
needs network access and build tooling inside the image. The driver fetches
checksum-pinned runtime/package archives, builds the current production loader
and native controls, and runs the applications automatically.

## Scope

| Report                             | Automatic check                                                                                                                                                     | Boundary                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Electron renderer loading (#867)   | Original Electron 8 application, first load plus three reloads in every cache mode.                                                                                 | Pinned Linux reproduction, not every Electron release.                                                                       |
| VS Code extension loading (#915)   | Original extension activates in VS Code 1.66.2, executes its command, and obtains a valid port from get-port 6.1.2.                                                 | Fresh extension-host processes; UI Reload Window is not automated.                                                           |
| Renderer errors (#691)             | Electron 8 reconstruction checks syntax/runtime errors in DevTools and window events, then healthy reload recovery.                                                 | Authored reconstruction of the reported mechanism; not the deleted original application.                                     |
| Native-addon import failure (#817) | Original application plus full USB 1.6.0 builds check ABI rejection, require/import, responsive debugging, and sixteen native queue callbacks.                      | Requires the native USB source fix described below; minimal-addon controls are separately labelled.                          |
| Shared VM corruption (#917)        | Offline shared-realm emulation and actual WebContainer SDK in Chromium, with graph loads, caught rejections, descriptor checks, and a reconstructed consumer build. | The historical Ember dependency graph remains unverified.                                                                    |
| Global REPL VM shortcut (#886)     | Native Node tests cover static imports through the active global REPL and programmatic `useGlobal` REPLs.                                                           | Direct native VM methods and isolated VM scripts retain script grammar; this check belongs to Vitest, not the desktop image. |

The original/reconstructed applications run with disabled, cold, and warm loader
caches. Committed source provenance, licences, and hashes are documented in
[test fixtures](../test/fixture/hosts/README.md).

## Native USB repair

USB 1.6.0's global queues can touch libuv before Node rejects an incompatible
addon ABI. [The reviewed native patch](../script/patches/usb-1.6.0-defer-queue-init.patch)
defers queue initialisation until the addon has been accepted. The Docker build
applies it and compiles ABI-64 and Electron ABI-70 binaries. Published and freshly
compiled unchanged ABI-64 binaries are retained as expected crashing negative
controls. Patched mismatched binaries must reject without killing Electron;
compatible ones must import and keep debugger/native callbacks responsive.

Installing `esm-sync` alone does not patch an already installed defective USB
binary. Affected applications need the patched/rebuilt native dependency.
Physical USB devices are not required for these queue/initialisation checks.

## Offline, online, and reports

Desktop checks run under Xvfb with Docker networking disabled. The real
WebContainer phase runs automatically in disposable Chromium with network
access. Its browser uses `--no-sandbox` inside the disposable container. No
manual browser session, asset transfer, or dependency installation is required.
An unavailable browser/network/host prerequisite produces a nonzero result;
exit code 2 identifies a blocked host check and never means success.

Reports and diagnostic logs are exported to
`.cache/host-verification/run-*/reports/`. The aggregate `report.json` includes
individual controls and offline/online evidence. Validation checks the current
loader digest, unique run nonce, cache phases, consumer builds, descriptors,
negative controls, report export, and container removal. Missing, stale,
partial, or contradictory evidence fails the run. Containers are removed;
Docker may retain cached images and downloads for later runs.

For all library/tooling tests alongside these checks, use
[the complete driver](MAINTAINER_GUIDE.md#verification).
