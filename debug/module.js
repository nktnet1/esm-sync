/* eslint-disable node/no-unsupported-features */

import fs from "node:fs"

export const randomVariable = "helloworld"

export {
  randomVariable as default,
  randomVariable as "module.exports",
  fs
}
