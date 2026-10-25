// These modules install parser methods for their side effects. Fixture setup
// must be type-checkable before their downloaded JavaScript exists.
declare module "*acorn/src/expression.js" {}
declare module "*acorn/src/location.js" {}
declare module "*acorn/src/lval.js" {}
declare module "*acorn/src/node.js" {}
declare module "*acorn/src/scope.js" {}
declare module "*acorn/src/statement.js" {}
declare module "*acorn/src/tokencontext.js" {}
declare module "*acorn/src/tokenize.js" {}

declare module "*acorn/src/identifier.js" {
  export function isIdentifierChar(code: number, astral?: boolean): boolean
  export function isIdentifierStart(code: number, astral?: boolean): boolean
  export const reservedWords: Record<number, string>
}
declare module "*acorn/src/whitespace.js" {
  export const lineBreak: RegExp
  export const skipWhiteSpace: RegExp
}
declare module "*acorn/src/state.js" {
  export const Parser: import("./acorn.js").ParserConstructor
}
declare module "*acorn/src/locutil.js" {
  export function getLineInfo(input: string, offset: number): import("acorn").Position
}
declare module "*acorn/src/tokentype.js" {
  export const types: typeof import("acorn").tokTypes &
    Record<"_import" | "_false" | "_null" | "_true", import("./acorn.js").TokenType>
}
declare module "*acorn/src/util.js" {
  export function wordsRegexp(words: string): RegExp
}
declare module "json-6" {
  const JSON6: { parse(text: string): unknown }
  export default JSON6
}
declare module "punycode/" {
  export function toUnicode(domain: string): string
}
