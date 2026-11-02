# CI selection and caches

The stable **CI** completion job runs even for documentation-only changes.
Use it as the required aggregate check. Selection uses Node's built-in
TypeScript support without installing dependencies.

| Changes                                                                                                                   | Selected checks                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Markdown/docs only                                                                                                        | Selection and completion.                        |
| Tooling tests, benchmarks, lint configuration                                                                             | Ubuntu tooling.                                  |
| Release/packaging implementation or workflow                                                                              | Tooling, production, registry.                   |
| Runtime test listed in `config/test-suites.ts`                                                                            | OS/Node matrix, tooling, production, registry.   |
| Library/native code, shared helpers/configs, fixtures, build scripts, public entries, Pipeline/actions, or unknown inputs | Full library/tooling/production/registry checks. |
| Dependency manifests, workspace configuration, lockfile                                                                   | All checks including production audit.           |
| Manual/reusable workflow or tagged release                                                                                | All checks regardless of changed paths.          |

The library matrix is Linux/macOS/Windows on Node 22/24/26. Tooling and
production/registry verification run on Ubuntu/Node 24. Installed CJS/ESM
consumers also run on each OS's Node 24 job. New unclassified Vitest files
default to tooling; platform regressions opt into the shared runtime list.
Runtime-test moves/deletions still select the matrix.

Push selection uses the full `before..after` range; PRs use `base...head`.
NUL-delimited Git diffs include all paths, moves, deletions, and unusual
filenames without GitHub's 300-file filter limit. Missing history or malformed
inputs conservatively select everything. Superseded PR runs are cancelled;
main and release runs are not.

The pnpm store and verified Acorn/Test262 source fixtures are cached. Fixture
keys include OS, installed Acorn version, lockfile, and preparation scripts;
restores still validate required files and version/revision markers. Only
trusted main jobs save fixtures, with Node 24 the writer per OS. Windows
Node-API headers/import libraries use exact OS/architecture/Node-version keys.
Generated bundles, native binaries, and loader test caches are rebuilt.

Hashed original fixtures are pinned to LF in `.gitattributes`. A real Git
checkout regression enables `core.autocrlf=true` and proves conversion remains
active for a control file while original fixture hashes stay unchanged.

CodeQL retains weekly/manual scans and skips docs/excluded-fixture-only
push/PR changes. Account for those filters if its individual status is required.

For exhaustive local verification on macOS or Linux, use `pnpm verify:all` or
`node script/src/esm/verify-all.ts`. It runs all repository suites, full Test262,
package/registry/audit checks, benchmarks, and host checks; it does not apply
CI's changed-path selection. It runs the existing verification scripts natively on the active Node.js version, with Docker
reserved for host integrations. The Node 22/24/26 and operating-system matrix
is handled by CI.
