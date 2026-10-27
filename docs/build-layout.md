# Build layout

Maintained code lives in `src/`, `script/src/`, `config/`, `native/`, and `test/`.
All generated JavaScript, declarations, native binaries, and test workspaces belong
under the ignored `dist/` directory.

The root `esm.js`/`index.js` files and their `.d.ts` aliases are maintained
compatibility shims. They forward to `dist/` so direct filesystem entry paths
and Node versions without package export maps keep working.

| Maintained input                  | Output                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `src/bootstrap/{esm,index}.ts`    | `dist/{esm,index}.js` and `.d.ts`                                                |
| `src/index.ts`                    | `dist/esm/loader.js`                                                             |
| Compiler/runtime entry points     | `dist/build/*.js` in test builds                                                 |
| `script/src/*.ts`                 | `dist/script/*.js`                                                               |
| `script/src/build-sync-await.ts`  | `dist/script/build-sync-await.js` (published), `build-sync-await-dev.js` (local) |
| `native/sync-await.cc`            | `dist/native/<platform>-<arch>-<ABI>.node`                                       |
| `test/harness/` and fixture files | Disposable `dist/test/` workspace                                                |

`tsdown.config.mts` builds the public CommonJS entries separately, bundles the
loader, and generates the public declarations. It updates package exports;
compatibility aliases are added by its `customExports` callback. The original
CommonJS module context and public paths must remain intact. Production builds
use Oxc minification; the custom Babel transformation remains necessary for the
loader's strict/sloppy and equality semantics.

The CLI prepares a fresh `dist/test/` before builds or test execution that need
fixtures. It emits test helpers to their expected `.js`, `.cjs`, or `.mjs`
locations. A development-only `dist/node_modules` junction lets the copied
fixtures resolve workspace dependencies. No generated test files are published.

`pnpm build:prod` produces the public distribution; `pnpm build --test` also
produces standalone bundles used by tests. Builds prepare Acorn source when
necessary. `pnpm typecheck` does not emit files. Publishing includes only the
paths listed in `package.json` (`files`), plus standard package metadata.

The published native installer reuses a valid bundled async bridge or builds one
from included C++ source. Skipping installation scripts keeps ordinary loading
available; timer/I/O awaits need a compatible bridge. Test and Verdaccio consumers
verify both the
package exports and that installed bridge. See [TypeScript layout](typescript-migration.md)
and [compatibility tests](test-fixtures-and-compatibility.md).
