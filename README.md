# esm-sync

A synchronous ECMAScript module loader for CommonJS, maintained as a fork of
[esm](https://github.com/standard-things/esm) for
[import-sync](https://github.com/nktnet1/import-sync).

The fork supports modern package `exports` and private `imports` maps,
`node:` specifiers, dynamic imports, live bindings, and `import.meta` helpers
(`url`, `resolve`, `dirname`, `filename`, and `main`). Modules may declare their
own `require`, including one created with `createRequire(import.meta.url)`.

## Install and use

```sh
npm install esm-sync
```

In a CommonJS entry point:

```js
const load = require("esm-sync")(module)
module.exports = load("./main.js")
```

```js
// main.js
export const answer = 42
```

To enable Node's preload hooks for a script or REPL:

```sh
node --require esm-sync main.js
node --require esm-sync
```

Calling `require("esm-sync")` alone returns the factory; use its returned
require function to load modules. Built-in TypeScript declarations cover the
factory and its options.

Top-level `await`, asynchronous module dependencies, and module-body resource
disposal are supported. Synchronous timer/I/O awaits require a compatible native
bridge and the initial CommonJS startup stack. The bridge targets Node 22+;
ordinary loading retains the declared Node `>=6` range, with syntax support
limited by the host. Current CI tests Node 22, 24, and 26 on Linux, macOS, and
Windows. See [async module loading](docs/async-module-loading.md) for installation,
context restrictions, errors, and timeouts.

## Options

Pass options to `require("esm-sync")(module, options)`, or configure them with
an `"esm"` package field, `.esmrc[.json]` (JSON6), `.esmrc.js`/`.cjs`/`.mjs`, or
`ESM_OPTIONS` (JSON6 or a configuration-file path).

| Option       | Default    | Purpose                                                                                                         |
| ------------ | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `mode`       | `"auto"`   | Detect module syntax; `"all"` treats files as ESM except `.cjs`/`"use script"`; `"strict"` selects `.mjs` only. |
| `cjs`        | `true`     | Enable CommonJS conveniences in eligible `.js` modules, or configure individual features below.                 |
| `mainFields` | `["main"]` | Legacy package entry fields; a package `exports` map takes precedence.                                          |
| `cache`      | `true`     | Enable persistent compilation caching; use a string for its directory or `false` to disable it.                 |
| `sourceMap`  | automatic  | Include inline source maps when enabled.                                                                        |
| `await`      | `false`    | Also permit top-level await in modules without ESM exports.                                                     |
| `force`      | `false`    | Apply this configuration across package boundaries.                                                             |
| `wasm`       | `false`    | Enable WebAssembly module loading on capable hosts.                                                             |
| `debug`      | `false`    | Expose loader internals in diagnostic stacks.                                                                   |

`cjs` accepts booleans for `cache`, `esModule`, `extensions`,
`mutableNamespace`, `namedExports`, `paths`, and `vars`. These default to `true`
in zero-configuration `.js` interop. `dedefault` and `topLevelReturn` default
to `false`. Strict `.mjs` graphs retain their ESM boundaries. See
[interop and migration](docs/interop-and-migration.md) for default-export
unwrapping, Mocha setup, package resolution, mocking, and native Node migration.

Set `ESM_DISABLE_CACHE=true` or `1` before loading to bypass persistent compiler
and bootstrap caches. This does not re-evaluate modules already in memory.

## Development

With Node 24.14+ and Docker Engine/Desktop on macOS or Linux, run the complete
self-contained verification from the checkout:

```sh
node script/src/esm/verify-all.ts
```

`pnpm verify:all` is the equivalent package script. Dependencies and native
builds run in disposable Linux/amd64 containers. The command runs all Vitest
projects and full Test262 selection in development and production on Node
22/24/26, installed CJS/ESM packages, release benchmarks, formatting, types,
unused-code checks, dependency audits, a disposable registry, and automated
Electron/VS Code/USB/WebContainer checks. It requires network access for image,
package, fixture, and real WebContainer downloads. A failed or blocked stage
makes the command fail; logs and summaries are saved under `.cache/verification/`.
This complements the operating-system CI matrix.

- [Maintainer guide and focused commands](docs/MAINTAINER_GUIDE.md)
- [CI selection and caches](docs/ci.md)
- [Host integration scope](docs/host-integrations.md)
- [Original application and performance checks](docs/tooling-and-performance.md)
- [Compatibility scope and remaining work](docs/FORK_ISSUES_ROADMAP.md)
- [v3.4.0 release notes](docs/releases/v3.4.0.md)
- [Release procedure](script/RELEASING.md)
