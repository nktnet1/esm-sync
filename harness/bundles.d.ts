// The build exports the same compiler object from the checked implementation.
declare module "*/build/compiler.js" {
  const compiler: typeof import("../src/compiler.js").default
  export default compiler
}
