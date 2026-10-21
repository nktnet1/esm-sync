# Dependency hygiene (Phase 4)

## Scope and review

The published package declares only one runtime dependency, `punycode`. The
`punycode/` import in `src/real/punycode.js` requires the userland package; it is
not a redundant reference to Node's built-in module. The build embeds Acorn and
other loader code, so a production-only package audit does **not** audit the
contents of the generated bundle.

Direct development dependencies were checked against build scripts, Babel and
Rspack configuration, fixture preparation, CLI executables and the active
third-party interoperability scenarios. There is no confirmed unused direct
dependency to remove safely at this point. In particular:

- Babel plugins and Webpack/Rspack tooling are still used by the current build;
  remove them as part of Phase 8, not ahead of the bundler migration.
- Mocha, AVA, Jest, Jasmine, Lab, NYC, `ts-node`, Babel register and Webpack
  CLI cover real external-host scenarios. See
  [test-fixtures-and-compatibility.md](test-fixtures-and-compatibility.md).
- `npm-check-updates` remains a manually invoked maintenance tool.

Avoid changing the majors of these legacy host packages without confirming
that their interoperability tests still exercise their intended behaviour.

## Security override review

The pnpm 12 lockfile and installed dependency manifests were examined for
matching transitive requirements. Ten selectors in `pnpm-workspace.yaml` did
not match any dependency requirement in that graph and were removed:

| Package | Removed selector(s) |
| --- | --- |
| `@grpc/grpc-js` | `<1.8.22` |
| `axios` | `<0.31.0` |
| `degenerator` | `<3.0.1` |
| `pac-resolver` | `<5.0.0` |
| `postcss` | `<8.5.10` |
| `protobufjs` | `^8.0.0 <8.2.0` |
| `systeminformation` | `^4.17.0 <=5.31.5` |
| `tar` | `<6.2.1`, `>7.0.0 <=7.5.9` |
| `uuid` | `^4.0.0 <14.0.0` |

The remaining 23 selectors match at least one declared dependency range. They
are deliberately retained, including the `yargs` 16/17 CommonJS patches used
for Node 26 compatibility. Some security overrides force a different major
version than the parent requested (for example, `got` in the legacy
`update-notifier` chain). Do not widen or remove those overrides without a
real-host compatibility test and a current advisory review.

**An inactive selector is not proof that its advisory has disappeared.** The
review is based on the current dependency graph; repeat it when changing
major dependencies or regenerating the lockfile. Lockfile changes are kept out
of incremental patches, and the lockfile must be regenerated with pnpm 12
before enabling frozen installs in CI.

## Ongoing audit

`pnpm audit:prod` checks for high/critical advisories in the published
dependency graph. CI runs it once, on Node 26; registry errors should fail the
job instead of being ignored. `pnpm audit:all` performs the broader high/critical
audit including development tools and interoperability dependencies. Triage
those advisories individually rather than applying automated major upgrades
to the legacy build or runner stack immediately before Phase 8.

The local audit environment has no access to the npm registry. A fresh
registry-backed `pnpm audit:all` and `pnpm outdated` review therefore remain
necessary before marking the full dependency-security review complete.
