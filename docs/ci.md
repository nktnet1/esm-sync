# CI selection and caches

Pipeline always reports a stable **CI** job, including documentation-only
changes. Use that job as the required completion check. Its selection job uses
Node's built-in TypeScript support and needs no dependency installation.

| Changed inputs                                                                                                                                     | Checks                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Markdown/docs only                                                                                                                                 | Selection and completion only                                        |
| Tooling test, benchmark or lint configuration                                                                                                      | Ubuntu tooling job                                                   |
| Release/packaging implementation or release workflow                                                                                               | Tooling, production and registry verification                        |
| Runtime test listed in `config/test-suites.ts`                                                                                                     | OS/Node library matrix, tooling and production/registry verification |
| Library/native source, shared configs/helpers, fixtures, build/test scripts, public entries/declarations, Pipeline/local actions or unknown inputs | Library matrix, tooling and production/registry verification         |
| Dependency manifests, workspace configuration or lockfile                                                                                          | All checks, including production dependency audit                    |
| Manual or reusable workflow call, or tag/release                                                                                                   | All checks regardless of changed files                               |

`config/test-suites.ts` is shared with Vitest so newly introduced tests default
to the tooling job in both places. Add platform-dependent regressions to its
runtime list. A runtime test deletion or move still selects the matrix.

Push comparisons include the complete `before..after` range; PR comparisons
use `base...head` to exclude unrelated changes on the base branch. A local Git
diff with NUL delimiters includes all paths, including renamed/deleted files
and filenames containing newlines. It does not rely on GitHub's 300-file path
filter limit. Missing history, malformed payloads and new-branch zero SHAs
fall back to all checks. Reusable workflows default to full verification;
the tagged release does not inherit a partial selection.

The library matrix remains Linux/macOS/Windows on Node 22/24/26. Production
and registry verification run once on Ubuntu when selected. Superseded PR
runs are cancelled; main-branch and release runs are not cancelled.

pnpm's existing package-store cache is retained. The local fixture action adds
an OS-specific cache for Acorn sources and the pinned prepared Test262 corpus,
keyed by installed Acorn version, lockfile and the preparation scripts. Preparation
still checks required files and version/revision markers on every restore.
Only trusted main-branch jobs save source fixtures; the library matrix's Node
24 job is the writer per OS. Windows Node-API headers/import libraries use an
exact OS/architecture/Node-version cache and are exported on cache hits too.

Build outputs, native binaries and loader test caches are not restored from CI
caches. Builds continue to validate current sources and native ABI compatibility;
cache regressions retain control over their own cold/warm state.

CodeQL skips documentation and excluded fixture-only changes on push/PR, while
retaining its weekly scheduled scan and manual trigger. If CodeQL's workflow
status is independently required by branch protection, account for those path
filters when configuring required checks.

`test/vitest/ci-changes.test.ts` exercises real temporary Git histories, including
multi-commit pushes, divergent PR bases, more than 300 paths, moves/deletions,
unusual filenames, release forcing and conservative failure fallbacks.
