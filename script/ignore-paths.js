"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const fs_extra_1 = __importDefault(require("fs-extra"));
const globby_1 = __importDefault(require("globby"));
const path_1 = __importDefault(require("path"));
const rootPath = path_1.default.resolve(__dirname, "..");
const gitignorePath = path_1.default.resolve(rootPath, ".gitignore");
const patterns = fs_extra_1.default
    .readFileSync(gitignorePath, "utf8")
    .split(/\r?\n/)
    .map((sourceLine) => {
    sourceLine = sourceLine.trim();
    if (sourceLine !== "") {
        return sourceLine.startsWith("/") ? sourceLine.slice(1) : "**/" + sourceLine;
    }
    return sourceLine;
})
    .filter(Boolean);
module.exports = globby_1.default
    .sync(patterns, {
    absolute: true,
    cwd: rootPath,
    dot: true,
    expandDirectories: false,
    onlyFiles: false
})
    .map((thePath) => path_1.default.normalize(thePath));
