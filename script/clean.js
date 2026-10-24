"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_extra_1 = __importDefault(require("fs-extra"));
const globby_1 = __importDefault(require("globby"));
const ignore_paths_js_1 = __importDefault(require("./ignore-paths.js"));
const path_1 = __importDefault(require("path"));
const trash_js_1 = __importDefault(require("./trash.js"));
const rootPath = path_1.default.resolve(__dirname, "..");
const nodeModulesPath = path_1.default.resolve(rootPath, "node_modules");
const keptPaths = [nodeModulesPath];
const trashPaths = ignore_paths_js_1.default.filter(isKept);
function cleanEmptyDirs() {
    return Promise.all(globby_1.default
        .sync(["*/**/"], {
        absolute: true,
        cwd: rootPath,
        expandDirectories: false,
        onlyDirectories: true
    })
        .filter(isEmpty)
        .map(trash_js_1.default));
}
function cleanNodeModules() {
    return (0, trash_js_1.default)(nodeModulesPath);
}
function cleanRepo() {
    return Promise.all(trashPaths.map(trash_js_1.default));
}
function isEmpty(dirPath) {
    return !fs_extra_1.default.readdirSync(dirPath).length;
}
function isKept(thePath) {
    return keptPaths.every((dirname) => !thePath.startsWith(dirname));
}
cleanRepo().then(cleanEmptyDirs).then(cleanNodeModules);
