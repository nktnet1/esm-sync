export async function prepare() {
  await import("./await-counter.mjs")
  await import("./async-syntax.mjs")
  await import("./deferred.mjs")
}
