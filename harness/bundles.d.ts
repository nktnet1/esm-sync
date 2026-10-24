// The build exports the same compiler object from the checked implementation.
declare module "*/build/compiler.js" {
  const compiler: typeof import("../src/compiler.js").default
  export default compiler
}
declare module "*/build/get-file-path-from-url.js" {
  const value: typeof import("../src/util/get-file-path-from-url.js").default
  export default value
}
declare module "*/build/get-url-from-file-path.js" {
  const value: typeof import("../src/util/get-url-from-file-path.js").default
  export default value
}
