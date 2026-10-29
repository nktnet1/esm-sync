# Package exports

Bare package names and self references honor `package.json` exports before `main`
or the configured `mainFields`. An export map also limits which subpaths can be
loaded by package name. A missing, blocked, or invalid target does not fall back
to a private file, another condition, a legacy main, or a directory index.

Static and dynamic imports use the `import` condition. CommonJS and the loader's
require factory, including `require.resolve`, use `require`. Conditions follow
their declaration order, and resolution caches keep the two modes separate.

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./features/*": "./dist/features/*.js",
    "./features/private/*": null
  }
}
```

Exact entries take precedence over patterns; overlapping patterns use the most
specific prefix and suffix. Targets are exact filenames, including `.cjs` files.
Arrays select a matching valid target without testing whether its file exists;
a missing selected file is an error. Targets and captured subpaths reject path
traversal, `node_modules` segments, and encoded path separators.

The loader honors `node`, `default`, the host's `node-addons` and `module-sync`
conditions, and custom `--conditions`/`-C` values from CLI arguments or
`NODE_OPTIONS`. `--no-addons` disables the addons condition.

For compatibility with [Node 13 folder maps](https://nodejs.org/download/release/v13.2.0/docs/api/esm.html#esm_package_exports),
`"./": "./dist/"` is also supported, including nested files. Current Node uses
`"./*": "./dist/*"` for the equivalent mapping. Exact entries and more specific
null mappings take precedence over the legacy folder mapping too.
