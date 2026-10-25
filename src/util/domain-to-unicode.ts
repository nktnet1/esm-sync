import { toUnicode as punycodeToUnicode } from "../safe/punycode.js"
import { domainToUnicode as urlToUnicode } from "../safe/url.js"
import shared from "../shared.js"

function init() {
  const toUnicode = typeof urlToUnicode === "function" ? urlToUnicode : punycodeToUnicode

  function domainToUnicode(domain: unknown) {
    return typeof domain === "string" ? (toUnicode as (value: string) => string)(domain) : ""
  }

  return domainToUnicode
}

export default shared.inited
  ? shared.module.utilDomainToUnicode
  : (shared.module.utilDomainToUnicode = init())

export type CachedModule = ReturnType<typeof init>
