"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const execa_1 = __importDefault(require("execa"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const trash_js_1 = __importDefault(require("./trash.js"));
const build_sync_await_js_1 = __importDefault(require("./build-sync-await.js"));
const commander_1 = require("commander");
commander_1.program.option("--prod", "enable production mode").option("--test", "enable test mode");
commander_1.program.parse(process.argv);
const argv = commander_1.program.opts();
const NODE_ENV = argv.prod ? "production" : "development";
const ESM_ENV = NODE_ENV + (argv.test ? "-test" : "");
const rootPath = path_1.default.resolve(__dirname, "..");
const buildPath = path_1.default.resolve(rootPath, "build");
const loaderPath = path_1.default.resolve(rootPath, "esm/loader.js");
const acornPath = path_1.default.resolve(rootPath, "src/vendor/acorn/acorn/src/state.js");
const acornPackagePath = path_1.default.resolve(rootPath, "src/vendor/acorn/acorn/package.json");
const package_json_1 = __importDefault(require("acorn/package.json"));
const acornVersion = package_json_1.default.version;
const trashPaths = [buildPath, loaderPath];
function assertFixturesReady() {
    const isReady = fs_extra_1.default.existsSync(acornPath) &&
        fs_extra_1.default.existsSync(acornPackagePath) &&
        fs_extra_1.default.readJSONSync(acornPackagePath).version === acornVersion;
    if (!isReady) {
        throw new Error("Acorn fixture is missing or outdated. Run `pnpm fixtures:acorn` before building.");
    }
}
function cleanRepo() {
    return Promise.all(trashPaths.map(trash_js_1.default));
}
function copyBundle() {
    const srcPath = path_1.default.resolve(buildPath, "esm.js");
    if (!fs_extra_1.default.existsSync(srcPath)) {
        throw new Error("Rspack completed without producing build/esm.js");
    }
    return fs_extra_1.default.copy(srcPath, loaderPath);
}
function makeBundle() {
    return (0, execa_1.default)("rspack", ["--config", "script/rspack-config.js"], {
        cwd: rootPath,
        env: {
            ESM_ENV,
            NODE_ENV
        },
        stdio: "inherit"
    });
}
Promise.resolve()
    .then(assertFixturesReady)
    .then(() => (0, build_sync_await_js_1.default)({ required: argv.test }))
    .then(cleanRepo)
    .then(makeBundle)
    .then(copyBundle)
    .catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
