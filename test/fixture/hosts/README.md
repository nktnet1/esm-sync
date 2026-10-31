# Desktop-host reproductions

The original #867/#915 and get-port fixtures are copied verbatim from the supplied upstream archives.
They retain the original file names, module syntax, package manifests and
licences. The host verifier stages private copies, supplies the built fork as
`esm`, and compiles the original extension TypeScript. It never installs the
reproductions' historical development dependency trees.

| Fixture | Pinned source | Included licence |
| --- | --- | --- |
| `issue-867` | `aistrych/electron-quick-start` at `9ca5498beacf08d1572ffee05df385faad261dd0` | `issue-867/LICENSE.md` (CC0) |
| `issue-915` | `hakonhagland/vscode-test-getport` at `50431382967ed8d6ca45e81433b2c753c5356a70` | `issue-915/LICENSE` (Artistic 2.0) |
| `get-port-6.1.2` | Original `get-port@6.1.2` npm package | `get-port-6.1.2/license` (MIT) |

Only files used by the reproductions and their licences are retained. No
lockfiles, generated extension output, archives or desktop binaries are checked
in. Regression tests anchor the executed source files to their original
SHA-256 hashes. Updating the fixtures requires an explicit provenance review.

The two desktop runtime archives are fetched separately by the TypeScript
downloader during the Docker build, verified against pinned SHA-256 hashes,
and cached under the ignored `.cache/host-runtimes/` directory. The built image
contains everything needed to run the reproductions offline.

`issue-691` is a newly authored reconstruction of the invalid renderer `await`
in [the original report](https://github.com/standard-things/esm/issues/691), plus
a runtime-error control. It uses this repository's MIT licence. It is not the
deleted `stack-trace-repro` branch: the current GitHub repository and all seven
Software Heritage snapshots available on 31 October 2026 lacked that branch;
Wayback returned its temporarily-offline page. The earliest available snapshot
is [adb9b2f59fa0ffe103ad5c16e182a52cc25c2e7c](https://archive.softwareheritage.org/api/1/snapshot/adb9b2f59fa0ffe103ad5c16e182a52cc25c2e7c/).
The reconstruction reuses Electron 8.0.0 from #867 and records both native
DevTools exception frames and unsuppressed window error events. It does not
establish a result for the original deleted application or Electron version.
