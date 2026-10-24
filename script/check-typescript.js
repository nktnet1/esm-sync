"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const package_json_1 = require("../package.json");
const semver_1 = __importDefault(require("semver"));
const expected = package_json_1.devDependencies.typescript;
let installed;
try {
    const metadata = require("typescript/package.json");
    if (metadata === null ||
        typeof metadata !== "object" ||
        !("version" in metadata) ||
        typeof metadata.version !== "string") {
        throw new TypeError("TypeScript package metadata has no version");
    }
    installed = metadata.version;
}
catch (error) {
    console.error(`Unable to load TypeScript: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}
if (installed && !semver_1.default.satisfies(installed, expected)) {
    console.error(`Installed TypeScript ${installed} does not satisfy ${expected}. ` +
        "Synchronise dependencies with package.json before running type checks.");
    process.exitCode = 1;
}
