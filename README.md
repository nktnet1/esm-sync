# esm-sync

**This is a fork of [esm](https://github.com/standard-things/esm)**: the brilliantly simple, babel-less, bundle-less ECMAScript module loader.

This fork includes:

- Updates from [@httptoolkit/esm](https://github.com/httptoolkit/esm) and the
  [esm-wallaby fork](https://www.npmjs.com/package/esm-wallaby), plus modern
  JavaScript syntax, `node:` imports, and compatibility with recent Node.js versions.
- Support for modules that declare their own `require`, including
  `const require = createRequire(import.meta.url)`.
- Modern package `exports` and private `imports` maps, conditional resolution,
  dynamic imports, and Node-compatible `import.meta` helpers.
- Synchronous ESM graphs with top-level `await`, async iteration, and resource
  disposal. Timer- and I/O-settled awaits require an optional native bridge
  on supported Node.js runtimes.
- Deferred imports, source-phase imports, and text/bytes import attributes
  (with runtime requirements for immutable bytes).
- Faster cached imports and large re-export graphs, improved live bindings,
  CommonJS interop, and Jest/coverage/REPL compatibility.
- Built-in types for use in TypeScript projects.

This package is maintained for use in the [import-sync](https://github.com/nktnet1/import-sync) project.

You may also be interested in [jiti](https://github.com/unjs/jiti), another loader supporting synchronous imports.

See the [release notes](docs/releases/) for recent changes.

## Install

```sh
npm install esm-sync
```

## Getting started

There are two ways to enable `esm-sync`.

1. Enable `esm-sync` for packages:

   Use `esm-sync` to load the main ES module and export it as CommonJS.

   **index.js**

   ```js
   // Set options as a parameter, environment variable, or rc file.
   const load = require("esm-sync")(module/*, options*/)
   module.exports = load("./main.js")
   ```

   **main.js**

   ```js
   // ESM syntax is supported.
   export {}
   ```

2. Enable `esm-sync` for local runs:

   ```shell
   node -r esm-sync main.js
   ```

   :bulb: Omit the filename to enable `esm-sync` in the REPL.

## Features

CommonJS interoperability is enabled by default for `.js` modules. Strict `.mjs` graphs retain their ESM boundaries and do not enable CommonJS convenience options.

Out of the box `esm-sync` just works, no configuration necessary, and supports:

- [`import`](https://ponyfoo.com/articles/es6-modules-in-depth#import)/[`export`](https://ponyfoo.com/articles/es6-modules-in-depth#export),
  including string-named exports, star re-exports, cyclic graphs, and
  [live bindings](https://ponyfoo.com/articles/es6-modules-in-depth#bindings-not-values)
- [`import.meta`](https://github.com/tc39/proposal-import-meta): `url`, `resolve`, `dirname`, `filename`, and `main`
- Dynamic `import()`, static `import defer`, and dynamic `import.defer()`
- Source-phase `import source` / `import.source()` for `.source` resources,
  and `type: "text"` / `type: "bytes"` import attributes
- Top-level `await`, module-body `for await...of`, `using`, and `await using`
- Package `exports` / private `imports`, ordered conditions (including custom
  `--conditions`), and `node:` built-ins
- File URLs, symlink-aware module identity, and persistent compiled-code/V8 bytecode caching
- Node `stdin`, [`--eval`](https://nodejs.org/api/cli.html#cli_e_eval_script),
  [`--print`](https://nodejs.org/api/cli.html#cli_p_print_script), and
  [`--check`](https://nodejs.org/api/cli.html#cli_c_check)
- Compatibility with Node REPLs (including programmatic REPLs), Jest, coverage
  tools, Electron, VS Code, and WebContainer environments

JavaScript semantics are also tested against selected
[Test262](https://github.com/tc39/test262) conformance cases.

### Synchronous top-level await

The CommonJS factory can load a module and its asynchronous dependencies
**synchronously**, returning fully evaluated exports:

```js
// status.mjs
export const status = await Promise.resolve("ready")
```

```js
// index.cjs
const load = require("esm-sync")(module)
console.log(load("./status.mjs").status) // ready
```

Microtask-settled awaits work without a native addon. Awaits requiring timers
or I/O need the optional native bridge on supported runtimes and must run
during initial CommonJS startup. Synchronous re-entry from an active callback
or Promise reaction is restricted. If an await cannot complete, the loader
reports a pending, re-entry, or timeout error rather than partial exports. Configure the
polling deadline with `ESM_SYNC_AWAIT_TIMEOUT_MS` (default `5000` milliseconds).

See [synchronous async-module loading](docs/async-module-loading.md) for
native-bridge installation, cycles, deferred evaluation, resource cleanup, and
error codes.

### Extended import forms

The loader also understands newer module syntax:

```js
import defer * as lazy from "./feature.mjs" // evaluates on namespace access
import text from "./feature.mjs" with { type: "text" } // source as a string
import source parsed from "./feature.source" // parse without evaluating
```

Dynamic `import.defer()` is also supported. Source-phase imports are currently
for `.source` resources, not arbitrary JavaScript modules. `type: "bytes"`
imports require native immutable `ArrayBuffer` support; when available, they
return a `Uint8Array` backed by an immutable buffer. Otherwise they fail
explicitly. Text, bytes, and source imports do not execute the resource as
JavaScript.

### Package resolution and CommonJS interop

- Package `exports` and `#private` `imports` respect package boundaries and
  declaration-order conditions, including `import`, `require`, `node-addons`,
  `module-sync`, and custom Node conditions. Invalid or blocked selected targets
  do not silently fall back to other files.
- `import.meta.resolve()` understands package mappings, relative/file URLs,
  and built-in modules; `import.meta.dirname`, `filename`, and `main` provide
  Node-style metadata.
- `.js` interop supports `createRequire(import.meta.url)`, named CommonJS
  exports, and optional default-export unwrapping with `cjs.dedefault: true`.
  Strict `.mjs` graphs retain ESM boundaries.

See [interoperability and migration](docs/interop-and-migration.md) for the
precise default-export rules, Mocha setup, package resolution, and mocking
behaviour.

The supported Node.js engine range is declared in [package.json](package.json).
Newer syntax, runtime APIs, and the optional native bridge have additional
host requirements described in the linked feature documentation.

## Options

Specify options with one of the following:

- `"esm"` field in `package.json`
- CJS/ESM in an `.esmrc.js`, `.esmrc.cjs`, or `.esmrc.mjs` file
- [JSON6](https://github.com/d3x0r/json6) in an `.esmrc` or `.esmrc.json` file
- JSON6 or file path in the `ESM_OPTIONS` environment variable
- `ESM_DISABLE_CACHE` environment variable (set to `1` or `true` to bypass persistent compiler and bootstrap caches without clearing modules already in memory)

<table>
<tr>
  <td colspan="2"><code>{</code></td>
</tr>
<tr>
  <td valign="top"><code>"cjs":true</code></td>
  <td>
    <p>A boolean or object for toggling CJS features in ESM.</p>
    <details>
      <summary>Features</summary>
      <table>
      <tr>
        <td colspan="2"><code>{</code></td>
      </tr>
      <tr>
        <td valign="top"><code>"cache":true</code></td>
        <td>
          <p>A boolean for storing ES modules in <code>require.cache</code>.</p>
        </td>
      </tr>
      <tr>
        <td valign="top"><code>"esModule":true</code></td>
        <td>
          <p>A boolean for <code>__esModule</code> interoperability.</p>
        </td>
      </tr>
      <tr>
        <td valign="top"><code>"extensions":true</code></td>
        <td>
          <p>A boolean for respecting <code>require.extensions</code> in ESM.</p>
        </td>
      </tr>
      <tr>
        <td valign="top"><code>"mutableNamespace":true</code></td>
        <td>
          <p>A boolean for mutable <a href="https://ponyfoo.com/articles/es6-modules-in-depth#import-all-the-things">namespace objects</a>.</p>
        </td>
      </tr>
      <tr>
        <td valign="top"><code>"namedExports":true</code></td>
        <td>
          <p>A boolean for <a href="https://ponyfoo.com/articles/es6-modules-in-depth#importing-named-exports">importing named exports</a> of CJS modules.</p>
        </td>
      </tr>
      <tr>
        <td valign="top"><code>"paths":true</code></td>
        <td>
          <p>A boolean for following CJS <a href="https://github.com/nodejs/node-eps/blob/master/002-es-modules.md#432-removal-of-non-local-dependencies">path rules</a> in ESM.</p>
        </td>
      </tr>
      <tr>
        <td valign="top"><code>"vars":true</code></td>
        <td>
          <p>A boolean for <code>__dirname</code>, <code>__filename</code>, and <code>require</code> in ESM.</p>
        </td>
      </tr>
      <tr>
        <td valign="top"><code>"dedefault":false</code></td>
        <td>
          <p>A boolean for requiring ES modules without the dangling <code>require().default</code>.</p>
        </td>
      </tr>
      <tr>
        <td valign="top"><code>"topLevelReturn":false</code></td>
        <td>
          <p>A boolean for top-level <code>return</code> support.</p>
        </td>
      </tr>
      <tr>
        <td colspan="2"><code>}</code></td>
      </tr>
      </table>
    </details>
  </td>
</tr>
<tr>
  <td valign="top"><code>"mainFields":["main"]</code></td>
  <td>
    <p>An array of fields checked when importing a package.</p>
  </td>
</tr>
<tr>
  <td valign="top"><code>"mode":"auto"</code></td>
  <td>
    <p>A string mode:</p>
    <ul>
      <li><code>"auto"</code> detect files with <code>import</code>, <code>import.meta</code>, <code>export</code>,<br><a href="https://github.com/tc39/proposal-modules-pragma"><code>"use module"</code></a>, or <code>.mjs</code> as ESM.</li>
      <li><code>"all"</code> files besides those with <code>"use script"</code> or <code>.cjs</code> are treated as ESM.</li>
      <li><code>"strict"</code> to treat <strong>only</strong> <code>.mjs</code> files as ESM.</li>
    </ul>
  </td>
</tr>
<tr>
  <td valign="top"><code>"await":false</code></td>
  <td>
    <p>A boolean for <a href="https://github.com/tc39/proposal-top-level-await">top-level <code>await</code></a> in modules without ESM exports.</p>
  </td>
</tr>
<tr>
  <td valign="top"><code>"force":false</code></td>
  <td>
    <p>A boolean to apply these options to all module loads.</p>
  </td>
</tr>
<tr>
  <td valign="top"><code>"debug":false</code></td>
  <td>
    <p>A boolean for including loader internals in error stacks for debugging.</p>
  </td>
</tr>
<tr>
  <td valign="top"><code>"wasm":false</code></td>
  <td>
    <p>A boolean for <a href="https://nodejs.org/api/globals.html#globals_webassembly">WebAssembly</a> module support, when available in the host runtime.</p>
  </td>
</tr>
<tr>
  <td colspan="2"><code>}</code></td>
</tr>
</table>

## DevOpts

<table>
<tr>
  <td colspan="2"><code>{</code></td>
</tr>
<tr>
  <td valign="top"><code>"cache":true</code></td>
  <td>
    <p>A boolean for toggling cache creation or a cache directory path.</p>
  </td>
</tr>
<tr>
  <td valign="top"><code>"sourceMap":undefined</code></td>
  <td>
    <p>Automatically include inline source maps in development and debugging contexts; set to <code>true</code> or <code>false</code> to override.</p>
  </td>
</tr>
<tr>
  <td colspan="2"><code>}</code></td>
</tr>
</table>

### Disk cache

By default, compiled modules and V8 bytecode are cached under each package's
`node_modules/.cache/esm/` directory; the loader bootstrap has a separate cache
within the `esm-sync` installation. Set the `cache` option to `false` or provide
a custom directory to control compilation caching. Set `ESM_DISABLE_CACHE=1`
(or `true`) to bypass both persistent caches, including the bootstrap cache.

Disk caches speed up subsequent starts; they do **not** store evaluated module
state or force modules to re-evaluate. Clearing them does not reset modules
already loaded in memory. Cached re-exports and live bindings retain their
runtime semantics.

## Tips

### Bundling

- For bundlers like [`browserify`](http://browserify.org/)+[`esmify`](https://github.com/mattdesl/esmify),
  [`parcel-bundler`](https://parceljs.org/), and [`webpack`](https://webpack.js.org/)
  add a `"module"` field to `package.json` pointing to the main ES module.

  ```json
  {
    "main": "index.js",
    "module": "main.js"
  }
  ```

### Extensions

- Enable `esm-sync` for [`wallaby.js`](https://wallabyjs.com/) following their
  [integration example](https://wallabyjs.com/docs/integration/node.html#es-modules).

### Loading

- Load `esm-sync` before loaders/monitors like
  [`@babel/register`](https://babeljs.io/docs/en/next/babel-register.html),
  [`newrelic`](https://github.com/newrelic/node-newrelic),
  [`ts-node`](https://github.com/TypeStrong/ts-node#programmatic).

- Load `esm-sync` for [`jasmine`](https://jasmine.github.io/) using the
  [`"helpers"`](https://jasmine.github.io/setup/nodejs.html#configuration)
  field in `jasmine.json`:

  ```json
  "helpers": [
    "node_modules/esm-sync"
  ]
  ```

- Load `esm-sync` with “node-args" options of:<br>
  - [`pm2`](https://pm2.io/doc/en/runtime/reference/pm2-cli/#pm2-flags): `--node-args="-r esm-sync"`

- Load `esm-sync` with “require” options of
  [`ava`](https://github.com/avajs/ava/blob/master/docs/recipes/es-modules.md),
  [`nodemon`](https://nodemon.io/),
  [`nyc`](https://github.com/istanbuljs/nyc#require-additional-modules),
  [`qunit`](https://qunitjs.com/),
  [`tape`](https://github.com/substack/tape#preloading-modules), and
  [`webpack`](https://webpack.js.org/api/cli/#config-options).

  :bulb: Native `require()` support for `.mjs` depends on your Node version.
  Use the `esm-sync` factory when a synchronous loader is needed.

- For Mocha, preload with Node's `--require esm-sync` rather than Mocha's own
  `--require esm-sync` option. See [Mocha setup and interoperability](docs/interop-and-migration.md).
