# Dependency maintenance

`punycode` is the only declared production dependency; `src/real/punycode.ts`
uses its userland `punycode/` entry. Acorn and other runtime code are embedded
in the build, so a production dependency audit cannot inspect every bundled
source.

The external test runners (AVA, Jest, Mocha, Jasmine, Lab, NYC, `ts-node`,
Webpack, and Babel register) have actual interoperability scenarios. Do not
remove or upgrade them solely because the production bundle does not import
them. See [compatibility tests](test-fixtures-and-compatibility.md).

`pnpm-workspace.yaml` contains targeted security overrides, including overrides
for legacy consumers on newer Node versions. Review advisories, resolved
versions, and host compatibility before changing them. Re-evaluate overrides
when the dependency graph changes; an unused selector does not imply its
vulnerability is resolved.

Useful checks:

```sh
pnpm audit:prod
pnpm audit:all
```

The first checks published dependencies; the second includes development and
test tooling. Review findings before applying major updates. The lockfile is
maintained locally when changing dependencies but excluded from incremental
patches. Registry-backed audit results depend on current registry access.

## Unused-code checks

`pnpm lint:unused` runs Knip. Its entry points include generated CLI tasks,
compiled native-test harnesses, and third-party scenario drivers. Test fixtures
loaded by filename are excluded from unused-file reporting. Exceptions cover
runtime-resolved Babel plugins, externally launched test tools, and types
indexed through the loader's module registry. Review those exceptions when
changing the build or test integrations.
