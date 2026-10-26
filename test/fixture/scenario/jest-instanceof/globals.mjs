import commonjs from "./globals.js"

export { commonjs }

export function read() {
  return { DOMException, performance, crypto, navigator }
}

export function createError() {
  return new DOMException("Cancelled", "AbortError")
}
