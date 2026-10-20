"use strict"

const fs = require("fs-extra")
const path = require("path")

const options = {
  glob: false
}

let _trash

function trash(iterable) {
  const paths = Array.from(typeof iterable === "string" ? [iterable] : iterable)
    .map((thePath) => path.resolve(String(thePath)))
    .filter(fs.existsSync)

  if (!paths.length) {
    return Promise.resolve()
  }

  if (_trash === void 0) {
    _trash = require("trash")
  }

  // Propagate failures so a failed cleanup cannot report a successful build/test.
  return _trash(paths, options)
}

module.exports = trash
