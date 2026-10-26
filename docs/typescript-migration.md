# TypeScript layout and checking

Development tooling, the loader, bootstrap, and maintained test harness are
TypeScript. Published consumers still load CommonJS JavaScript and need no
TypeScript runtime.

## Module boundaries

- The root package remains CommonJS. Changing it to `"type": "module"` would
  break `require("esm-sync")`, direct entry-point requires, and CLI preloads.
- `script/src/esm/`, `test/harness/`, and `test/vitest/` have private ESM
  scopes. Their `.ts` imports use explicit extensions. `.cts` marks helpers
  that must remain CommonJS.
- JavaScript compatibility fixtures are deliberately maintained as JavaScript:
  they test the loader's parser, module goals, extensions, and legacy hosts.
- `script/src/esm/outputs.ts` fixes emitted test helper filenames, including
  `.mjs` and `.cjs` where the module goal matters. The CLI rewrites only owned
  helper specifiers, not fixture imports.

## Building and public types

`tsdown.config.mts` generates `dist/esm.js`, `dist/index.js`, the loader, and
`dist/esm.d.ts`/`dist/index.d.ts`. Public option types are maintained in
`src/types/public.ts`. The two bootstrap entries export a callable CommonJS
factory, and `package.json` retains the `esm`, `esm.js`, `index`, and
`index.js` compatibility paths. tsdown manages the primary export; a small
callback adds type conditions and aliases.

Public bootstrap output must preserve its CommonJS `module`, `require`, and
sloppy-mode behaviour. The bundled loader keeps its Babel source transforms;
production output uses tsdown's Oxc minifier. The published native bridge
installer is also CommonJS and does not depend on development tooling.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Strict no-emit checks and the owned-type audit |
| `pnpm fixtures:acorn` | Prepare the Acorn source fixture |
| `pnpm build:prod` | Build the published package |
| `pnpm build --test` | Build test bundles and harness output |
| `pnpm test:run:prod` | Run tests against an existing production test build |

`pnpm typecheck` checks the root TypeScript project, tooling, bootstrap, harness,
and separate AVA TypeScript fixture. Type checking has no output side effects
and works before bundling. The source configurations enable `strict`,
`noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`; the additional
audit in `script/src/esm/check-type-safety.ts` detects inferred `any` in owned
code. Build commands perform these checks before emitting development helpers.

For generated paths and package contents, see [build layout](build-layout.md).
