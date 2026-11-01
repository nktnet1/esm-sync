# Desktop-host fixtures

Original application files retain their names, syntax, manifests, and licences.
The host verifier stages private copies, supplies the current loader as `esm`,
and compiles the original extension TypeScript without installing historical
application development trees.

| Fixture | Pinned source | Licence |
| --- | --- | --- |
| `issue-867` | `aistrych/electron-quick-start` at `9ca5498beacf08d1572ffee05df385faad261dd0` | `issue-867/LICENSE.md` (CC0) |
| `issue-915` | `hakonhagland/vscode-test-getport` at `50431382967ed8d6ca45e81433b2c753c5356a70` | `issue-915/LICENSE` (Artistic 2.0) |
| `issue-817` application | `dsanders11/electron-quick-start` at `5e0749955d9489a30f742f5597f432dc4a6b1562` | `issue-817/LICENSE.md` (CC0) |
| `get-port-6.1.2` | Original npm package | `get-port-6.1.2/license` (MIT) |

Regression tests verify original source SHA-256 hashes; `.gitattributes` pins
LF bytes on Windows. Updating these fixtures requires provenance review. No
archives, desktop binaries, or generated extension output are checked in.

`issue-691` is an authored MIT reconstruction of the reported renderer syntax
error, plus runtime-error and recovery controls. It reuses Electron 8 and checks
DevTools frames and unsuppressed window error events. It does not represent the
deleted original application or its exact Electron version.

`issue-917` is an authored MIT shared-intrinsic VM regression and reconstructed
consumer, not the historical Ember application. Verification includes offline
VM controls and the actual WebContainer SDK in Chromium with automatically
mounted JavaScript, consumer files, and vendored punycode. A loader with its
shared-realm guard disabled supplies the offline negative control.

`issue-817` also contains authored MIT minimal-addon, queue, and crash-trace
controls. They are labelled separately from the full original USB 1.6.0 checks.
The Docker builder downloads checksum-pinned USB/libusb/Nan/bindings sources
and published binaries with their licences, applies the reviewed native patch,
and compiles ABI-64/70 controls. Published and freshly compiled unpatched
ABI-64 binaries remain crashing negative controls. Compatible patched imports
must keep debugging and sixteen queue callbacks responsive without physical
USB hardware.

Runtime archives, headers, packages, extracted SDK, and reports remain under
ignored `.cache/` paths. The Docker command builds all assets and runs desktop
checks offline, then real WebContainer checks online. See
[host integrations](../../../docs/host-integrations.md) for commands and limits.
