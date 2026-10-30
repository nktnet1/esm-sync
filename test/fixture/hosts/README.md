# Original desktop-host reproductions

These small fixtures are copied verbatim from the supplied upstream archives.
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
contains everything needed to run both reproductions offline.
