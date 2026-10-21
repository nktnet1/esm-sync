import { createHash } from "../safe/crypto.js"

import shared from "../shared.js"

function init() {
  function md5(string) {
    const hash = createHash("md5")

    if (typeof string === "string") {
      hash.update(string)
    }

    return hash.digest("hex")
  }

  return md5
}

export default shared.inited ? shared.module.utilMD5 : (shared.module.utilMD5 = init())
