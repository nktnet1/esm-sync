# Interoperability, Mocha, and native ESM migration

This guide covers CommonJS interoperability, Mocha setup, and native ESM
migration. The examples use `esm-sync`. Replace historical `require("esm")` calls with the fork's
package name when following them. See the [maintainer guide](MAINTAINER_GUIDE.md)
for contributor information and [async module loading](async-module-loading.md)
for the fork's synchronous top-level-await boundaries.

## CommonJS default-export unwrapping

Upstream report: [https://github.com/standard-things/esm/issues/885](https://github.com/standard-things/esm/issues/885).

`cjs.dedefault` changes what a CommonJS caller receives when it loads an ES
module through the fork. With the default `false`, the caller receives a
namespace and reads its `.default`. With `true`, a module exporting **only
`default`** returns that value directly.

For this example, keep the consumer project in a CommonJS scope with this
`package.json`:

```json
{ "type": "commonjs" }
```

```js
// plugin.js (loaded by esm-sync)
export default function activate() {
  return "activated"
}
```

```js
// namespace.cjs
const load = require("esm-sync")(module, { cjs: { dedefault: false } })
const plugin = load("./plugin.js")
console.log(plugin.default()) // activated
```

```js
// unwrapped.cjs
const load = require("esm-sync")(module, { cjs: { dedefault: true } })
const activate = load("./plugin.js")
console.log(activate()) // activated
```

Run each entry in a fresh process: `node namespace.cjs` and `node unwrapped.cjs`.
Configure the factory before the target is first loaded. Changing a factory's
options does not re-evaluate an already loaded module.

| Target loaded through the fork                 | `dedefault: false`        | `dedefault: true` |
| ---------------------------------------------- | ------------------------- | ----------------- |
| `.js` with only `export default value`         | Namespace with `.default` | `value`           |
| `.js` with a default and named exports         | Namespace                 | Namespace         |
| `.js` with only named exports                  | Namespace                 | Namespace         |
| `.mjs` ES module                               | Namespace                 | Namespace         |
| CommonJS `module.exports = { default: value }` | CommonJS exports object   | Same object       |

The option does not change `import activate from "./plugin.js"`. Strict `.mjs`
loading does not apply this CommonJS convenience option. An explicit ES-module
export named `"module.exports"` selects a separate CommonJS interop value and
takes precedence. See the [implementation](../src/entry.ts).

## Mocha preloads and factory entry points

Upstream report: [https://github.com/standard-things/esm/issues/873](https://github.com/standard-things/esm/issues/873).

For a CommonJS project whose `.js` tests use ESM syntax, use **Node's** preload
before starting the project's installed Mocha:

```sh
node --require esm-sync ./node_modules/mocha/bin/mocha "test/**/*.test.js"
```

For example:

```js
// src/greet.js
export function greet(name) {
  return `Hello, ${name}`
}
```

```js
// test/greet.test.js
import assert from "node:assert/strict"
import { greet } from "../src/greet.js"

describe("greet", function () {
  it("greets by name", function () {
    assert.equal(greet("Ada"), "Hello, Ada")
  })
})
```

A bare `require("esm-sync")` inside a setup file obtains the loader factory.
It does not activate Node's preload path or replace Mocha's own `require` with a
configured factory. Likewise, assigning a factory result to the setup file's
local `require` only changes that file. Mocha's own `--require esm-sync` also
loads the factory as setup. It is not equivalent to Node's preload above in
this fork. Use the Node preload when Mocha should discover the test files.
Other setup work can follow it as a Mocha argument:

```sh
node --require esm-sync ./node_modules/mocha/bin/mocha --require ./test/setup.cjs "test/**/*.test.js"
```

Here `test/setup.cjs` contains ordinary CommonJS setup work, without eagerly
loading the specs.

To supply factory options instead, make a CommonJS bootstrap the **test entry**:

```js
// test/bootstrap.cjs
const load = require("esm-sync")(module, { cjs: { dedefault: true } })
load("./greet.test.js")
```

```sh
mocha test/bootstrap.cjs
```

Select the bootstrap alone. It loads the selected specs through its configured
factory. Do not also discover those specs with a glob. Do not eagerly load them
from `mocha --require ./test/bootstrap.cjs`: preloads run before the BDD interface
provides `describe` and `it` to test files. Register hooks in a preload and load
tests at the test-entry stage. See Mocha's
[run cycle](https://mochajs.org/explainers/run-cycle-overview/).

These commands are verified with the repository's Mocha 8.4.0 in serial mode.
Additional transpiler hooks need their own configuration and ordering checks.
For native ESM tests, use `.mjs` or a `"type": "module"` scope and omit the fork's
preload. See [Mocha's native ESM guidance](https://mochajs.org/explainers/nodejs-native-esm-support/).

## Migrating a consumer project to native Node ESM

Upstream report: [https://github.com/standard-things/esm/issues/838](https://github.com/standard-things/esm/issues/838).

The examples below target Node 24. Verification used Node 22.23.4, 24.21.0, and
26.12.0. Choose an explicit module format in the **consumer project**: retain
`.mjs` for selected ESM files, or set `"type": "module"` to treat its `.js` files
as ESM. Rename remaining CommonJS entry points and configuration files to `.cjs`.
Do not change this fork's CommonJS package root as part of a consumer migration.
See Node's [package scopes and extensions](https://nodejs.org/download/release/latest-v24.x/docs/api/packages.html#packagejson-and-file-extensions).

An existing `.mjs` implementation can stay `.mjs`. No adjacent `.js` loader shim
is needed once callers use native `import`. Renaming it to `.js` requires a
module scope. While still using the fork, `.mjs` deliberately restricts its
interop options, including `cjs.dedefault`. Renaming files alone does not preserve
those extensions.

1. Replace the application loader factory or preload with native `import` and
   `export`. Use complete relative specifiers such as `./service.js` and
   `./feature/index.js`. Native ESM does not search extensions or directory indexes.
2. Replace CommonJS wrapper variables. Use `import.meta.url` for module-relative
   resources. When filesystem paths are needed, derive them explicitly:

   ```js
   import { fileURLToPath } from "node:url"
   import { dirname } from "node:path"

   const __filename = fileURLToPath(import.meta.url)
   const __dirname = dirname(__filename)
   ```

3. Review CommonJS dependencies. A native default import receives `module.exports`:

   ```js
   // legacy.cjs: module.exports = { answer: 42 }
   import legacy from "./legacy.cjs"
   const { answer } = legacy
   ```

   Prefer that form when named-export detection cannot identify a dependency's
   exports. For APIs that specifically need CommonJS resolution, create an
   explicit native require:

   ```js
   import { createRequire } from "node:module"
   const require = createRequire(import.meta.url)
   const legacy = require("./legacy.cjs")
   ```

   This is Node's `require`, with Node's loading rules. It does not install the fork.

4. Audit fork-specific options and test hooks before removing them:

   | Existing dependency on the fork                  | Native migration check                                                                       |
   | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
   | `cjs.dedefault`                                  | Explicitly read a namespace's `.default` in CommonJS, or use a native default import in ESM. |
   | `cjs.vars`                                       | Replace wrapper variables or use `createRequire` deliberately.                               |
   | `cjs.mutableNamespace`                           | Replace namespace mutation with an exported API for changing state.                          |
   | `mainFields`, implicit paths                     | Check package `exports` and its import/require conditions. Use explicit local paths.         |
   | `require.cache`, CommonJS mocking/register hooks | Verify native ESM tests separately. Native imports have their own cache and loading path.    |

5. Run the application's actual startup and tests without the preload. Verify
   initialization order and single evaluation as well as outputs. Remove the
   dependency, `.esmrc` settings, and preload references from scripts, Mocha
   configuration, and `NODE_OPTIONS` once those checks pass.

The [Node ESM reference](https://nodejs.org/download/release/latest-v24.x/docs/api/esm.html)
describes native imports, interop, and the differences from CommonJS.

### CommonJS callers and top-level await

On Node 24, native `require()` can load an ESM graph only when the entire graph
is synchronous. It normally returns a namespace, with a `.default` property for
a default export. Top-level await anywhere in that graph causes
`ERR_REQUIRE_ASYNC_MODULE`. An exported `async` function alone does not make
module evaluation asynchronous. See Node's
[`require(esm)` rules](https://nodejs.org/download/release/latest-v24.x/docs/api/modules.html#loading-ecmascript-modules-using-require).

Use an asynchronous startup boundary for a graph containing top-level await:

```js
// database.mjs
await new Promise((resolve) => setTimeout(resolve, 10))
export const ready = true
```

```js
// main.cjs (no esm-sync preload)
async function main() {
  const { ready } = await import("./database.mjs")
  if (!ready) throw new Error("Database is not ready")
  console.log("ready") // Start HTTP listening here, after initialization.
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
```

Alternatively, a native ESM entry can statically import `ready` from
`./database.mjs`. Its body runs after that dependency completes. Keep readiness
after the awaited initialization. The fork's
[synchronous async-module bridge](async-module-loading.md) is a separate loading
path with its own documented limits.
