# Releasing esm-sync

Use Node 24.14+, pinned pnpm, matching Node headers, and a C++20 compiler.
Prepare dependencies/fixtures locally and require passing Pipeline checks on
`main`. Release scripts do not install tooling.

## npm Trusted Publishing

Configure the npm trusted publisher for owner `nktnet1`, repository `esm-sync`,
workflow `publish.yaml`, and GitHub environment `Production`, allowing direct
`npm publish`. The environment may require reviewers. Protect `main` and `v*`
tags and merge publishing code into the default branch before tagging.

Publish uses `id-token: write`, GitHub-hosted Node 24 and npm 11.5.1+, without
an `NPM_TOKEN`. No dependency install or build runs in the OIDC publishing job.

## Beta and stable versions

Choose the next stable base explicitly; for example, after `3.4.0`:

```sh
pnpm release:beta --base 3.4.1 --dry-run
pnpm release:beta --base 3.4.1 --publish
```

The read-only dry run checks npm and local/remote tags to propose `-beta.N`.
An unreleased current beta can continue without `--base`; an already stable
base must be advanced explicitly. Without `--publish`, the tool changes only
the manifest and runs checks, leaving commit/tag/push to the maintainer.
Do not rerun `--publish` on that dirty checkout.

With `--publish`, a clean `main` checkout is required. The tool checks fixtures,
lint, types, Vitest, production build/tests, packed consumers, and Verdaccio.
It commits the version, creates an annotated `v<version>` tag, and atomically
pushes main/tag. Check failures leave the version edit for inspection; inspect
local commit/tag state after a push failure before retrying.

For a stable release, set the intended stable version, run the same checks,
commit/push that tested commit to `main`, then create/push its matching annotated
tag (for example `v3.4.1`). Never reuse an npm version or tag a different commit.
`verify:all` provides broader local verification but does not publish a release.

## Build once, publish the verified artifact

A tag triggers **Release**, which requires the full Pipeline matrix. Only after
success does Linux/Node 24 build with the native bridge required, stage the
published manifest, pack without lifecycle scripts, validate the tarball, and
upload `release-packages` plus `release-metadata`.

**Publish** accepts only a successful Release from this repository. It checks
out trusted publishing code and validates the upstream SHA, remote annotated
tag's peeled commit, version policy, tarball manifest, and required files.
Prereleases publish to `beta`; stable versions publish to `latest`. It publishes
the exact uploaded tarball with `--ignore-scripts`.

Registry preflight compares SHA-512 integrity with an existing npm version.
An identical artifact is skipped; different bytes are rejected. After an
uncertain publish failure, the tool checks whether that same tarball was
accepted before retrying. Rerun Publish with the same uploaded artifact;
rebuilding an already published version can change its integrity.

To inspect downloaded artifacts in `release-packages/` and `release-metadata/`:

```sh
pnpm release:publish --tag=v3.4.1-beta.1 --registry=https://registry.npmjs.org --dry-run
```

Local publishing needs npm authentication; CI uses the `Production` environment
and supplies `--expected-sha`. A failed matrix prevents publication.
