# Compatibility scope and remaining work

Current source and regression tests define support. A passing mechanism test
does not certify every historical application or dependency graph associated
with an upstream issue.

| Area                                        | Current verification and boundary                                                                                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic imports (#829)                      | Both unchanged Dyo utility tests run through Mocha CLI and synchronous loading with disabled/cold/warm caches. Raw source hashes are checked, including a CRLF-enabled Git checkout. The full historical DOM suite is not included. |
| Package resolution                          | Public `exports`, private `imports`, mapping conditions, terminal errors, URL/symlink identity, and `import.meta` helpers are compared with native Node.                                                                            |
| Async modules                               | Evaluation, live bindings, failure identity, disposal, and cache reconstruction are covered; timer/I/O awaits retain the [native bridge context limits](async-module-loading.md).                                                   |
| Jest and mocking                            | Jest 26 integrations cover registry resets, isolation, constructor identity, and VM globals. Strict `.mjs` dependencies bypass CommonJS mocking hooks.                                                                              |
| Mocha and native migration                  | Current setup and export-shape rules are in [interop and migration](interop-and-migration.md).                                                                                                                                      |
| Babel (#810) and Log4brains (#844)          | Dedicated verifiers use separately installed original applications; synthetic startup checks do not certify their full graphs. See [tooling verification](tooling-and-performance.md).                                              |
| REPL (#791, #854, #886)                     | Global and programmatic REPL loading and static imports through the active global REPL's VM shortcut are covered. Arbitrary VM scripts keep their native grammar.                                                                   |
| Electron, VS Code, native USB, WebContainer | Automatic Docker checks and their exact original/reconstructed scopes are in [host integrations](host-integrations.md).                                                                                                             |

## Follow-ups that need new evidence or design

- Exercise newer Jest majors in their real execution environments before
  extending the Jest 26 compatibility claim.
- Define an explicit, scoped contract before adding `.mjs` mocking; preserve
  strict ESM behaviour for existing consumers.
- Verify PM2 cluster mode, Lerna-forwarded diagnostics, and packaged virtual
  filesystems in their actual hosts. Existing subprocess/fork tests alone do
  not certify those environments.
- Recover and run the historical Ember dependency graph before claiming that
  complete application works in WebContainer. The current real-host regression
  exercises the shared-VM failure and a reconstructed consumer.
- Treat hot reload and precompile APIs as design work. Compiler-cache deletion
  does not reset an evaluated module graph.

Browser-only/non-Node module loading and obsolete native timer-await runtimes
are outside the current support contract. Reopen a compatibility investigation
with a concrete failing reproduction, runtime version, cache configuration, and
expected behaviour. Use the [maintainer guide](MAINTAINER_GUIDE.md) for complete
and focused verification commands.
