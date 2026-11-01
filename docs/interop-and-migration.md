# Interoperability and native ESM migration

## CommonJS default-export unwrapping

A factory normally returns an ESM namespace. `cjs.dedefault: true` unwraps a
`.js` module that exports only `default`:

```js
// plugin.js, in a CommonJS package scope
export default function activate() {
  return "activated"
}
```

```js
// consumer.cjs
const load = require("esm-sync")(module, { cjs: { dedefault: true } })
console.log(load("./plugin.js")()) // activated
```

| Target                                              | Default behaviour         | `cjs.dedefault: true` |
| --------------------------------------------------- | ------------------------- | --------------------- |
| `.js` with only `export default value`              | Namespace with `.default` | `value`               |
| `.js` with named exports, with or without a default | Namespace                 | Namespace             |
| `.mjs`                                              | Namespace                 | Namespace             |
| CommonJS `module.exports = { default: value }`      | CommonJS object           | Same object           |

Configure the factory before first load. Changing options does not re-evaluate
an existing graph. An explicit ESM export named `"module.exports"` selects a
separate CommonJS interop value and takes precedence. Import syntax itself is
not changed by `dedefault`.

## Mocha preloads and factory entry points

For a CommonJS project whose `.js` tests use ESM syntax, preload through Node
before starting the installed Mocha:

```sh
node --require esm-sync ./node_modules/mocha/bin/mocha --require ./test/setup.cjs "test/**/*.test.js"
```

A bare `require("esm-sync")` returns a factory. Mocha's own `--require esm-sync`
loads that factory as setup and does not activate Node's preload path. Assigning
a factory to a setup file's local `require` also does not replace Mocha's loader.

To pass factory options, make a CommonJS bootstrap the test entry:

```js
// test/bootstrap.cjs
const load = require("esm-sync")(module, { cjs: { dedefault: true } })
load("./greet.test.js")
```

```sh
mocha test/bootstrap.cjs
```

Select that bootstrap alone; do not also discover its specs with a glob. Do not
load specs from a Mocha preload before `describe`/`it` are installed. These
patterns are covered with Mocha 8.4 in serial mode. Native ESM tests can use
`.mjs` or a `"type": "module"` scope without the fork's preload.

## Package resolution and mocking

Public `exports` and private `imports` honour condition order, package scopes,
exact targets, and path safety. A selected missing, invalid, or blocked target
is terminal. Arrays choose a valid mapping without filesystem-based fallback.
Native-comparison tests cover `import.meta.resolve`, `dirname`, `filename`,
`main`, file URLs, and symlink identity. These conveniences do not bypass a
package's private export boundary.

CommonJS mocking libraries can intercept eligible `.js` interop graphs. Strict
`.mjs` dependency graphs deliberately bypass CommonJS `Module._load` hooks.
Deleting compiler caches does not reset module identity; use a fresh process,
worker, or deliberately managed module registry for re-evaluation.

## Migrating a consumer project to native Node ESM

Choose an explicit format in the consumer: use `.mjs`, or set `"type": "module"`
for `.js`. Rename remaining CommonJS entries/configuration to `.cjs`. Keep this
fork's CommonJS package root unchanged.

1. Replace factory/preload loading with native `import`/`export`. Use complete
   relative specifiers such as `./service.js` and `./feature/index.js`.
2. Replace wrapper locals with module-relative URLs or native helpers:

   ```js
   import { createRequire } from "node:module"
   import { fileURLToPath } from "node:url"
   const require = createRequire(import.meta.url)
   const filename = fileURLToPath(import.meta.url)
   const asset = new URL("./asset.json", import.meta.url)
   ```

3. Review CommonJS default/named export assumptions and package conditions.
   Native CJS imports do not acquire the fork's mutable namespace or unwrapping
   options. Prefer the default import for an arbitrary CommonJS exports object.
4. Make startup asynchronous when dependencies await timers or I/O. Use native
   top-level await or an async entry function. Native `require()` of an async
   ESM graph can raise `ERR_REQUIRE_ASYNC_MODULE`.
5. Reconfigure test/coverage/transpiler hooks and verify the application on its
   chosen runtime. Renaming files alone does not preserve loader extensions.

See [async module loading](async-module-loading.md) for the fork's synchronous
await boundaries and the [maintainer guide](MAINTAINER_GUIDE.md) for checks.
