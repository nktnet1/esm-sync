import ESM from "../constant/esm.js"

import shared from "../shared.js"

function init() {
  const { PACKAGE_PARENT_NAME } = ESM

  function isJasmine() {
    return PACKAGE_PARENT_NAME === "jasmine"
  }

  return isJasmine
}

export default shared.inited ? shared.module.envIsJasmine : (shared.module.envIsJasmine = init())
