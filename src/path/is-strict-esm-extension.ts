// .mts always has the same ESM semantics as .mjs, regardless of package type.
function isStrictESMExtension(ext: string | null): boolean {
  return ext === ".mjs" || ext === ".mts"
}

export default isStrictESMExtension
