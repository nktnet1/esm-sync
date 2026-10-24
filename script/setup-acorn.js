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
const fs_1 = __importDefault(require("fs"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const rootPath = path_1.default.resolve(__dirname, "..");
const vendorPath = path_1.default.resolve(rootPath, "src/vendor");
const acornPath = path_1.default.resolve(vendorPath, "acorn");
const acornPackagePath = path_1.default.resolve(acornPath, "acorn/package.json");
const acornSourcePath = path_1.default.resolve(acornPath, "acorn/src/state.js");
const package_json_1 = __importDefault(require("acorn/package.json"));
const acornURL = "https://github.com/ternjs/acorn/archive/" + package_json_1.default.version + ".zip";
const extractFilterRegExp = /^acorn[\\/].*?\.(?:js|json)$/;
function isPrepared() {
    if (!fs_1.default.existsSync(acornPackagePath) || !fs_1.default.existsSync(acornSourcePath)) {
        return false;
    }
    try {
        const metadata = JSON.parse(fs_1.default.readFileSync(acornPackagePath, "utf8"));
        return (metadata !== null &&
            typeof metadata === "object" &&
            "version" in metadata &&
            metadata.version === package_json_1.default.version);
    }
    catch (_a) {
        return false;
    }
}
function setupAcorn() {
    return __awaiter(this, void 0, void 0, function* () {
        if (isPrepared()) {
            console.log(`[acorn] version ${package_json_1.default.version} is already prepared.`);
            return;
        }
        console.log("[acorn] downloading:", acornURL);
        const res = yield fetch(acornURL);
        if (!res.ok) {
            throw new Error(`[acorn] download failed: ${res.status} ${res.statusText}`);
        }
        const buffer = Buffer.from(yield res.arrayBuffer());
        console.log("[acorn] zip size:", buffer.length);
        yield promises_1.default.rm(acornPath, { force: true, recursive: true });
        yield promises_1.default.mkdir(acornPath, { recursive: true });
        const zip = new adm_zip_1.default(buffer);
        const entries = zip.getEntries();
        console.log("[acorn] entries:", entries.length);
        for (const entry of entries) {
            if (entry.isDirectory) {
                continue;
            }
            const filePath = entry.entryName;
            if (filePath.includes("..")) {
                continue;
            }
            const strippedPath = filePath.split(/[\\/]/).slice(1).join("/");
            if (!extractFilterRegExp.test(strippedPath)) {
                continue;
            }
            const destPath = path_1.default.join(acornPath, strippedPath);
            yield promises_1.default.mkdir(path_1.default.dirname(destPath), { recursive: true });
            yield promises_1.default.writeFile(destPath, entry.getData());
        }
        console.log("[acorn] setup complete.");
    });
}
module.exports = setupAcorn;
