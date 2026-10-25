# Repository guidance

- When testing canonical resolver results, canonicalise existing filesystem paths
  with `fs.realpath` / `fs.realpathSync` before comparing them. Preserve alias
  spelling only when explicitly testing symlink-preservation behaviour.
- Canonicalise a temporary directory immediately after `mkdtemp`, then derive
  expected filenames from that canonical directory. For a nonexistent target,
  canonicalise its existing parent rather than calling `realpath` on the target.
- macOS temporary paths may use `/var` or `/tmp` while their real paths start
  with `/private/var` or `/private/tmp`. `path.resolve` and `path.normalize` do
  not resolve these filesystem aliases.
- Do not strip or add `/private`, weaken path assertions, or skip macOS cases
  to hide a canonical-path mismatch.
- Exercise path-sensitive native tests with a symlinked temporary directory,
  retaining both cached and uncached coverage.
