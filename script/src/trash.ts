"use strict"

import fs from "fs-extra"
import path from "path"

const options = {
  glob: false
}

let _trash: ((paths: string[], options: { glob: boolean }) => Promise<void>) | undefined

function trash(iterable: string | Iterable<unknown, unknown, unknown>): Promise<void> {
  const paths = Array.from(typeof iterable === "string" ? [iterable] : iterable)
    .map((thePath) => path.resolve(String(thePath)))
    .filter(fs.existsSync)

  if (!paths.length) {
    return Promise.resolve()
  }

  if (_trash === void 0) {
    _trash = require("trash") as (paths: string[], options: { glob: boolean }) => Promise<void>
  }

  // Propagate failures so a failed cleanup cannot report a successful build/test.
  return _trash(paths, options)
}

export = trash
