import shared from "../shared.js"

function init() {
  const specialCharRegExp = /[\\^$.*+?()[\]{}|]/g

  function escapeRegExp(string: unknown) {
    return typeof string === "string" ? string.replace(specialCharRegExp, "\\$&") : ""
  }

  return escapeRegExp
}

export default shared.inited
  ? shared.module.utilEscapeRegExp
  : (shared.module.utilEscapeRegExp = init())

export type CachedModule = ReturnType<typeof init>
