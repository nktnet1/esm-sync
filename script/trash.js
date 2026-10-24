"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const options = {
    glob: false
};
let _trash;
function trash(iterable) {
    const paths = Array.from(typeof iterable === "string" ? [iterable] : iterable)
        .map((thePath) => path_1.default.resolve(String(thePath)))
        .filter(fs_extra_1.default.existsSync);
    if (!paths.length) {
        return Promise.resolve();
    }
    if (_trash === void 0) {
        _trash = require("trash");
    }
    // Propagate failures so a failed cleanup cannot report a successful build/test.
    return _trash(paths, options);
}
module.exports = trash;
