"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const execa_1 = __importDefault(require("execa"));
const golden_fleece_1 = __importDefault(require("golden-fleece"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const terser_1 = require("terser");
const rootPath = path_1.default.resolve(__dirname, "..");
const esmPath = path_1.default.resolve(rootPath, "esm.js");
const indexPath = path_1.default.resolve(rootPath, "index.js");
const pkgPath = path_1.default.resolve(rootPath, "package.json");
const readmePath = path_1.default.resolve(rootPath, "README.md");
const tableRegExp = /^<table>[\s\S]*?\n<\/table>/gm;
const terserOptions = fs_extra_1.default.readJSONSync(path_1.default.resolve(rootPath, ".terserrc"));
const defaultScripts = {
    test: 'echo "Error: no test specified" && exit 1'
};
const fieldsToRemove = ["devDependencies", "esm", "private", "scripts"];
const jsPaths = [esmPath, indexPath];
function cleanJS() {
    return __awaiter(this, void 0, void 0, function* () {
        for (const filename of jsPaths) {
            const content = fs_extra_1.default.readFileSync(filename, "utf8");
            const code = yield minifyJS(content);
            process.once("exit", () => fs_extra_1.default.outputFileSync(filename, content));
            fs_extra_1.default.outputFileSync(filename, code);
        }
    });
}
function cleanPackageJSON() {
    const content = fs_extra_1.default.readFileSync(pkgPath, "utf8");
    process.once("exit", () => fs_extra_1.default.outputFileSync(pkgPath, content));
    const pkgJSON = JSON.parse(content);
    for (const field of fieldsToRemove) {
        Reflect.deleteProperty(pkgJSON, field);
    }
    pkgJSON.scripts = defaultScripts;
    fs_extra_1.default.outputFileSync(pkgPath, golden_fleece_1.default.patch(content, pkgJSON));
}
function cleanReadme() {
    return __awaiter(this, void 0, void 0, function* () {
        const content = fs_extra_1.default.readFileSync(readmePath, "utf8");
        const matches = Array.from(content.matchAll(tableRegExp));
        const tables = yield Promise.all(matches.map(([table]) => minifyHTML(table)));
        let index = 0;
        process.once("exit", () => fs_extra_1.default.outputFileSync(readmePath, content));
        fs_extra_1.default.outputFileSync(readmePath, content.replace(tableRegExp, () => tables[index++]));
    });
}
function minifyHTML(content) {
    return __awaiter(this, void 0, void 0, function* () {
        // import/no-unresolved does not resolve packages with only ESM exports.
        const { minify } = yield import("html-minifier-next");
        return minify(content, {
            collapseBooleanAttributes: true,
            collapseWhitespace: true,
            decodeEntities: true,
            removeAttributeQuotes: true,
            removeComments: true,
            removeEmptyAttributes: true,
            removeEmptyElements: true,
            removeOptionalTags: true,
            removeRedundantAttributes: true,
            removeTagWhitespace: true
        });
    });
}
function minifyJS(content) {
    return __awaiter(this, void 0, void 0, function* () {
        const { code } = yield (0, terser_1.minify)(content, terserOptions);
        if (typeof code !== "string") {
            throw new Error("Terser did not produce JavaScript output");
        }
        return code;
    });
}
function publishPackage() {
    return (0, execa_1.default)("pnpm", ["publish"], {
        cwd: rootPath,
        stdio: "inherit"
    });
}
Promise.all([cleanJS(), cleanPackageJSON(), cleanReadme()])
    .then(publishPackage)
    .catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
