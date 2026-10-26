# Releasing esm-sync

Release tooling requires Node.js 24.14+ (or 26+), pnpm, a working C++ compiler
and matching Node headers. The existing `Pipeline` checks must pass on `main`
before a release. Install dependencies and prepare build fixtures locally first;
CI does these steps automatically. The release scripts do not install tooling.

## Configure npm Trusted Publishing once

Set up a trusted publisher for **esm-sync** at npmjs.com:

- GitHub owner: `nktnet1`
- Repository: `esm-sync`
- Workflow filename: `publish.yaml`
- Environment: `Production`
- Allow `npm publish` (direct publishing).

Create the `Production` environment in GitHub, optionally with required
reviewers. The `Publish` workflow uses `id-token: write`, GitHub-hosted runners
and npm 11.5.1+ on Node 24; it does not need an `NPM_TOKEN`. Protect `main` and
`v*` tags so that only release maintainers can publish. **Merge the workflows
and release scripts into the default branch before creating a release tag.**

## Create a beta

For a new beta series after `3.3.7`:

```sh
pnpm release:beta --base 3.3.8 --dry-run
pnpm release:beta --base 3.3.8 --publish
```

If the current manifest already contains an unreleased `3.3.8-beta.N`, omit
`--base` to continue the same beta series. `--dry-run` is read-only: it checks
npm's published versions, local tags and remote tags, then shows the next
numbered `-beta.N`. The tool never guesses whether your next stable base is a
patch, minor or major release. If the base is already stable on npm, you must
choose a newer base explicitly.

Without `--publish`, the tool updates only the manifest and runs the release
checks. Review the resulting version and commit/tag manually; do **not** run
`--publish` on that dirty checkout. With `--publish`, it requires a clean `main`
checkout, runs fixture preparation, lint, typecheck, Vitest, production build
and test, packed-consumer checks, and Verdaccio publish/install checks. It then
commits `package.json` with the version as the commit message, creates an
annotated `v<version>` tag and atomically pushes `main` and the tag to origin.
If checks fail, the uncommitted version edit is retained for inspection. If the
push fails, inspect the local commit and tag before retrying.

## Stable releases

When ready for `latest`, change the manifest to the intended stable version
(e.g. `3.3.8`), run the same checks, commit it and push the tested commit to
`main`. Create an annotated tag **`v3.3.8`** on that exact commit and push it.
The tag must match `package.json` exactly; CI never changes the version.
Never tag a different commit or reuse an already-published npm version.

## Tagged build, package and publish

A tag push runs **Release**, which invokes `Pipeline`. Library behaviour and
native Node integration run on Linux/macOS/Windows with Node 22/24/26. Native
installed-package checks run once per OS on Node 24; build, packaging, release,
fixture tooling, typechecks, lint, audit, and production/registry verification
run once on Ubuntu/Node 24. Only after every job succeeds does it
build the package on Linux/Node 24 with the native bridge required, stage the
same published manifest used by local Verdaccio smoke tests, and pack one
`.tgz` without executing lifecycle scripts. It validates the tarball before
uploading `release-packages` and `release-metadata` artifacts.

A separate **Publish** workflow runs only after a successful `Release` from
this repository. It checks out trusted publishing code from the workflow
revision (not the artifacts), downloads the two artifacts, and verifies the
upstream build SHA, the remote annotated tag's peeled commit, the npm tarball
manifest, required files and release-version policy:

- `v3.3.8-beta.2` -> `esm-sync@3.3.8-beta.2` under npm `beta`
- `v3.3.8` -> `esm-sync@3.3.8` under npm `latest`

No install or build commands run in the OIDC publish job. It uses npm trusted
publishing to publish the exact tarball with `--ignore-scripts`. Registry
preflight compares the local SHA-512 tarball integrity with any existing npm
version. A matching version is skipped; a mismatch is rejected. After an
uncertain or transient publish failure, it verifies whether npm accepted that
same tarball before deciding to retry. A failed publish can be retried using
the **same uploaded artifact** by rerunning the Publish job; rebuilding a
fresh tarball for an already-published version can change its integrity.

To inspect the downloaded artifacts locally, put the `.tgz` into
`release-packages/` and the metadata in `release-metadata/`, then run:

```sh
pnpm release:publish --tag=v3.3.8-beta.2 --registry=https://registry.npmjs.org --dry-run
```

A local `--tag` run does not use OIDC; publishing without `--dry-run` needs npm
authentication. CI exclusively supplies `--expected-sha` and uses the
`Production` environment. Running a tag build never publishes if any matrix
check fails.
